import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'

import {
	fleetBoardCreativeResponseSchema,
	fleetBoardHierarchyQuerySchema,
	fleetBoardHierarchyResponseSchema,
	fleetBoardRootQuerySchema,
	fleetBoardRootResponseSchema,
} from '../client/fleet-board'
import { logger } from '../core/logger'
import { db } from '../db'
import { ad, adAccount, adCreative, adSet, campaign, client } from '../db/schema'
import { apiError } from '../logic/apiError'
import { requireAuth, requireOrg, requireVerifiedAuth } from '../logic/auth'
import {
	normalizeCreative,
	readCreative,
	readFleetBoardChildren,
	readFleetBoardRoot,
	mediaUrlForKey,
} from '../fleet-board/read-model'
import { getHeartbeatDependencies } from '../sync/runtime'
import { runHeartbeat } from '../sync/account-tier'

const rootRoute = createRoute({
	method: 'get',
	path: '/',
	request: { query: fleetBoardRootQuerySchema },
	responses: {
		200: {
			description: 'Fleet Board roots',
			content: { 'application/json': { schema: fleetBoardRootResponseSchema } },
		},
	},
})

const hierarchyRoute = createRoute({
	method: 'get',
	path: '/hierarchy',
	request: { query: fleetBoardHierarchyQuerySchema },
	responses: {
		200: {
			description: 'Fleet Board hierarchy nodes',
			content: { 'application/json': { schema: fleetBoardHierarchyResponseSchema } },
		},
		404: { description: 'A parent is not visible in the active Agency' },
	},
})

const creativeRoute = createRoute({
	method: 'get',
	path: '/ads/{adId}/creative',
	request: { params: z.object({ adId: z.string().min(1).max(200) }) },
	responses: {
		200: {
			description: 'Creative detail',
			content: { 'application/json': { schema: fleetBoardCreativeResponseSchema } },
		},
		404: { description: 'Ad or Creative not visible in the active Agency' },
	},
})

const mediaRoute = createRoute({
	method: 'get',
	path: '/creatives/{creativeId}/media/{key}',
	request: { params: z.object({ creativeId: z.string().min(1).max(200), key: z.string().regex(/^m\d+$/) }) },
	responses: { 200: { description: 'Creative media stream' }, 404: { description: 'Media unavailable' } },
})

const fleetBoardBase = new OpenAPIHono()
fleetBoardBase.use('*', requireAuth, requireVerifiedAuth, requireOrg)

export const fleetBoardRoutes = fleetBoardBase
	.openapi(rootRoute, async c => {
		startBackgroundSync()
		const result = await readFleetBoardRoot(c.get('orgId'), c.req.valid('query'))
		return c.json(fleetBoardRootResponseSchema.parse(result), 200)
	})
	.openapi(hierarchyRoute, async c => {
		const query = c.req.valid('query')
		const result = await readFleetBoardChildren(c.get('orgId'), query.range, query.parents)
		if (!result) return apiError(c, 'NOT_FOUND')
		return c.json(fleetBoardHierarchyResponseSchema.parse(result), 200)
	})
	.openapi(creativeRoute, async c => {
		const record = await readCreative(c.get('orgId'), c.req.valid('param').adId)
		if (!record) return apiError(c, 'NOT_FOUND')
		return c.json(fleetBoardCreativeResponseSchema.parse(normalizeCreative(record.creative)), 200)
	})
	.openapi(mediaRoute, async c => {
		const params = c.req.valid('param')
		let record = await readCreativeByCreativeId(c.get('orgId'), params.creativeId)
		if (!record) return apiError(c, 'NOT_FOUND')
		let media = await fetchCreativeMedia(mediaUrlForKey(record.creative, params.key))
		if (!media) {
			await refreshCreative(record)
			record = await readCreativeByCreativeId(c.get('orgId'), params.creativeId)
			media = record ? await fetchCreativeMedia(mediaUrlForKey(record.creative, params.key)) : null
		}
		if (!media) return apiError(c, 'NOT_FOUND', { message: 'MEDIA_UNAVAILABLE' })
		return c.body(media.body, 200, { 'Content-Type': media.contentType, 'Cache-Control': 'private, max-age=300' })
	})

function startBackgroundSync() {
	try {
		const { metaClient } = getHeartbeatDependencies()
		runHeartbeat({ metaClient }).catch(error =>
			logger.warn('Fleet Board background sync failed', { category: errorCategory(error) }),
		)
	} catch {
		// Runtime configuration is intentionally absent in isolated API route tests.
	}
}

async function readCreativeByCreativeId(agencyId: string, creativeId: string) {
	const [owned] = await db
		.select({ creative: adCreative, ad })
		.from(adCreative)
		.innerJoin(ad, eq(adCreative.adId, ad.id))
		.innerJoin(adSet, eq(ad.adSetId, adSet.id))
		.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
		.innerJoin(adAccount, eq(campaign.adAccountId, adAccount.id))
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.where(and(eq(adCreative.id, creativeId), eq(client.agencyId, agencyId)))
		.limit(1)
	return owned ?? null
}

async function refreshCreative(record: NonNullable<Awaited<ReturnType<typeof readCreativeByCreativeId>>>) {
	try {
		const { metaClient } = getHeartbeatDependencies()
		const refreshed = await metaClient.getCreative(record.ad.id)
		if (!refreshed || refreshed.id !== record.creative.id) return
		await db
			.update(adCreative)
			.set({ name: refreshed.name, payload: refreshed.payload, updatedAt: new Date() })
			.where(eq(adCreative.id, record.creative.id))
	} catch (error) {
		logger.warn('Fleet Board creative media refresh failed', {
			creativeId: record.creative.id,
			category: errorCategory(error),
		})
	}
}

async function fetchCreativeMedia(url: string | null) {
	if (!url) return null
	try {
		const response = await fetch(url)
		const contentType = response.headers.get('content-type')?.split(';')[0] ?? ''
		if (!response.ok || !response.body || (!contentType.startsWith('image/') && !contentType.startsWith('video/')))
			return null
		return { body: response.body, contentType }
	} catch {
		return null
	}
}

function errorCategory(error: unknown) {
	return error instanceof Error ? error.name : 'unknown'
}
