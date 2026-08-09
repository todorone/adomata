import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'

import {
	fleetBoardAdPreviewResponseSchema,
	fleetBoardCreativeResponseSchema,
	fleetBoardHierarchyQuerySchema,
	fleetBoardHierarchyResponseSchema,
	fleetBoardRootQuerySchema,
	fleetBoardRootResponseSchema,
} from '../client/fleet-board'
import { logger } from '../core/logger'
import { db } from '../db'
import { ad, adAccount, adCreative, adSet, campaign, client, organizationSettings } from '../db/schema'
import { apiError } from '../logic/apiError'
import { requireAuth, requireOrg, requireVerifiedAuth } from '../logic/auth'
import {
	normalizeCreative,
	readCreative,
	readFleetBoardChildren,
	readFleetBoardRoot,
	mediaUrlForKey,
	needsCreativeMediaRefresh,
} from '../fleet-board/read-model'
import { fetchCreativeMedia, mediaRange } from '../fleet-board/media'
import { getHeartbeatDependencies, triggerBackgroundSync } from '../sync/runtime'

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

// Meta doesn't grant raw video-file access to third parties (see MetaClient.getAdPreview), so
// video-only creatives fall back to Meta's own hosted preview iframe at this fixed placement.
const videoAdPreviewFormat = 'MOBILE_FEED_STANDARD'

const previewRoute = createRoute({
	method: 'get',
	path: '/ads/{adId}/preview',
	request: { params: z.object({ adId: z.string().min(1).max(200) }) },
	responses: {
		200: {
			description: "Meta's hosted ad preview iframe URL for an Ad, when reachable",
			content: { 'application/json': { schema: fleetBoardAdPreviewResponseSchema } },
		},
		404: { description: 'Ad not visible in the active Agency' },
	},
})

const mediaRoute = createRoute({
	method: 'get',
	path: '/creatives/{creativeId}/media/{key}',
	request: {
		params: z.object({
			creativeId: z.string().min(1).max(200),
			key: z.string().regex(/^(m\d+|a-images-\d+|thumb)$/),
		}),
	},
	responses: { 200: { description: 'Creative media stream' }, 404: { description: 'Media unavailable' } },
})

const fleetBoardBase = new OpenAPIHono()
fleetBoardBase.use('*', requireAuth, requireVerifiedAuth, requireOrg)

export const fleetBoardRoutes = fleetBoardBase
	.openapi(rootRoute, async c => {
		triggerBackgroundSync()
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
		let record = await readCreative(c.get('orgId'), c.req.valid('param').adId)
		if (!record) return apiError(c, 'NOT_FOUND')
		if (needsCreativeMediaRefresh(record.creative)) {
			await refreshCreative(c.get('orgId'), record)
			record = await readCreative(c.get('orgId'), c.req.valid('param').adId)
			if (!record) return apiError(c, 'NOT_FOUND')
		}
		return c.json(fleetBoardCreativeResponseSchema.parse(normalizeCreative(record.creative)), 200)
	})
	.openapi(previewRoute, async c => {
		const agencyId = c.get('orgId')
		const record = await readCreative(agencyId, c.req.valid('param').adId)
		if (!record) return apiError(c, 'NOT_FOUND')
		const metaClient = await resolveMetaClient(agencyId)
		const previewUrl = metaClient ? await metaClient.getAdPreview(record.ad.id, videoAdPreviewFormat) : null
		return c.json(fleetBoardAdPreviewResponseSchema.parse({ previewUrl }), 200)
	})
	.openapi(mediaRoute, async c => {
		const params = c.req.valid('param')
		const agencyId = c.get('orgId')
		let record = await readCreativeByCreativeId(agencyId, params.creativeId)
		if (!record) return apiError(c, 'NOT_FOUND')
		const range = mediaRange(c.req.header('range'))
		let media = await fetchCreativeMedia(mediaUrlForKey(record.creative, params.key), range)
		if (!media) {
			await refreshCreative(agencyId, record)
			record = await readCreativeByCreativeId(agencyId, params.creativeId)
			media = record ? await fetchCreativeMedia(mediaUrlForKey(record.creative, params.key), range) : null
		}
		if (!media) return apiError(c, 'NOT_FOUND', { message: 'MEDIA_UNAVAILABLE' })
		const headers = {
			'Content-Type': media.contentType,
			'Cache-Control': 'private, max-age=300',
			...(media.contentLength ? { 'Content-Length': media.contentLength } : {}),
			...(media.contentRange ? { 'Content-Range': media.contentRange } : {}),
			...(media.acceptRanges ? { 'Accept-Ranges': media.acceptRanges } : {}),
		}
		return media.status === 206 ? c.body(media.body, 206, headers) : c.body(media.body, 200, headers)
	})

async function readCreativeByCreativeId(agencyId: string, creativeId: string) {
	const [owned] = await db
		.select({ creative: adCreative, ad, adAccountId: adAccount.id })
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

async function refreshCreative(
	agencyId: string,
	record: NonNullable<Awaited<ReturnType<typeof readCreativeByCreativeId>>>,
) {
	try {
		const metaClient = await resolveMetaClient(agencyId)
		if (!metaClient) return
		const refreshed = await metaClient.getCreative(record.ad.id, record.adAccountId)
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

async function resolveMetaClient(agencyId: string) {
	const { metaMode, buildMetaClient } = getHeartbeatDependencies()
	if (metaMode === 'fake') return buildMetaClient()
	const [row] = await db
		.select({ metaAccessToken: organizationSettings.metaAccessToken })
		.from(organizationSettings)
		.where(eq(organizationSettings.organizationId, agencyId))
		.limit(1)
	if (!row?.metaAccessToken) return null
	return buildMetaClient(row.metaAccessToken)
}

function errorCategory(error: unknown) {
	return error instanceof Error ? error.name : 'unknown'
}
