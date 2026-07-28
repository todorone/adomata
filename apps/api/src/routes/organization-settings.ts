import { randomUUID } from 'node:crypto'

import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'

import {
	organizationSettingsResponseSchema,
	updateOrganizationSettingsBodySchema,
} from '../client/organization-settings'
import { db } from '../db'
import { organizationSettings } from '../db/schema'
import { apiError } from '../logic/apiError'
import { requireAuth, requireOrg, requireVerifiedAuth } from '../logic/auth'
import type { OrgMember } from '../logic/auth'
import { MetaApiError } from '../meta/client'
import { getHeartbeatDependencies } from '../sync/runtime'

const getRoute = createRoute({
	method: 'get',
	path: '/',
	responses: {
		200: {
			description: 'Organization Settings for the active Agency',
			content: { 'application/json': { schema: organizationSettingsResponseSchema } },
		},
		403: { description: 'Only the Agency owner may view Organization Settings' },
	},
})

const putRoute = createRoute({
	method: 'put',
	path: '/',
	request: {
		body: { content: { 'application/json': { schema: updateOrganizationSettingsBodySchema } } },
	},
	responses: {
		200: {
			description: 'Organization Settings saved',
			content: { 'application/json': { schema: organizationSettingsResponseSchema } },
		},
		400: { description: 'The submitted Meta access token failed validation' },
		403: { description: 'Only the Agency owner may edit Organization Settings' },
	},
})

const organizationSettingsBase = new OpenAPIHono()
organizationSettingsBase.use('*', requireAuth, requireVerifiedAuth, requireOrg)

function isOwner(member: OrgMember) {
	return member.role === 'owner'
}

export const organizationSettingsRoutes = organizationSettingsBase
	.openapi(getRoute, async c => {
		if (!isOwner(c.get('orgMember'))) {
			return apiError(c, 'FORBIDDEN', { message: 'Лише власник агенції може переглядати ці налаштування' })
		}

		const [row] = await db
			.select()
			.from(organizationSettings)
			.where(eq(organizationSettings.organizationId, c.get('orgId')))
			.limit(1)

		return c.json(
			organizationSettingsResponseSchema.parse({
				hasToken: Boolean(row?.metaAccessToken),
				updatedAt: row?.updatedAt?.toISOString() ?? null,
				lastValidatedAt: row?.lastValidatedAt?.toISOString() ?? null,
			}),
			200,
		)
	})
	.openapi(putRoute, async c => {
		if (!isOwner(c.get('orgMember'))) {
			return apiError(c, 'FORBIDDEN', { message: 'Лише власник агенції може редагувати ці налаштування' })
		}

		const { metaAccessToken } = c.req.valid('json')

		try {
			const { buildMetaClient } = getHeartbeatDependencies()
			await buildMetaClient(metaAccessToken).verifyToken()
		} catch (error) {
			if (error instanceof MetaApiError) {
				return apiError(c, 'BAD_REQUEST', { message: `Не вдалося перевірити токен Meta: ${error.message}` })
			}
			throw error
		}

		const now = new Date()
		const [row] = await db
			.insert(organizationSettings)
			.values({
				id: randomUUID(),
				organizationId: c.get('orgId'),
				metaAccessToken,
				lastValidatedAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: organizationSettings.organizationId,
				set: { metaAccessToken, lastValidatedAt: now, updatedAt: now },
			})
			.returning()

		return c.json(
			organizationSettingsResponseSchema.parse({
				hasToken: true,
				updatedAt: row.updatedAt.toISOString(),
				lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
			}),
			200,
		)
	})
