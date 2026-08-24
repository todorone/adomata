import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

import { forceRefreshResponseSchema } from '../client/force-refresh'
import { apiError } from '../logic/apiError'
import { requireAuth, requireOrg, requireVerifiedAuth } from '../logic/auth'
import { ForceRefreshCooldownError, readForceRefresh, requestForceRefresh } from '../sync/force-refresh'
import { triggerForceRefresh } from '../sync/runtime'

const createForceRefreshRoute = createRoute({
	method: 'post',
	path: '/',
	responses: {
		202: {
			description: 'Force Refresh queued',
			content: { 'application/json': { schema: forceRefreshResponseSchema } },
		},
		429: { description: 'Force Refresh cooldown is active' },
	},
})

const getForceRefreshRoute = createRoute({
	method: 'get',
	path: '/{forceRefreshId}',
	request: { params: z.object({ forceRefreshId: z.string().uuid() }) },
	responses: {
		200: {
			description: 'Persisted Force Refresh status',
			content: { 'application/json': { schema: forceRefreshResponseSchema } },
		},
		404: { description: 'Force Refresh not found in the active Agency' },
	},
})

const forceRefreshBase = new OpenAPIHono()
forceRefreshBase.use('*', requireAuth, requireVerifiedAuth, requireOrg)

export const forceRefreshRoutes = forceRefreshBase
	.openapi(createForceRefreshRoute, async c => {
		try {
			const refresh = await requestForceRefresh({ agencyId: c.get('orgId') })
			triggerForceRefresh(c.get('orgId'), refresh.id)
			return c.json(forceRefreshResponseSchema.parse({ id: refresh.id, status: refresh.status }), 202)
		} catch (error) {
			if (error instanceof ForceRefreshCooldownError)
				return apiError(c, 'CONFLICT', { status: 429, message: 'Оновлення даних доступне раз на хвилину' })
			throw error
		}
	})
	.openapi(getForceRefreshRoute, async c => {
		const refresh = await readForceRefresh({
			agencyId: c.get('orgId'),
			forceRefreshId: c.req.valid('param').forceRefreshId,
		})
		if (!refresh) return apiError(c, 'NOT_FOUND')
		return c.json(forceRefreshResponseSchema.parse(refresh), 200)
	})
