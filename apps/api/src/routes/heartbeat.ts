import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

import { runHeartbeat } from '../sync/account-tier'
import { getHeartbeatDependencies } from '../sync/runtime'

const route = createRoute({
	method: 'post',
	path: '/',
	responses: {
		200: {
			description: 'Heartbeat completed',
			content: {
				'application/json': {
					schema: z.object({
						ok: z.literal(true),
						accountTier: z.object({
							processed: z.number(),
							failed: z.number(),
							skipped: z.number(),
							skippedNoToken: z.number(),
						}),
						insightsTier: z.object({
							processed: z.number(),
							failed: z.number(),
							skipped: z.number(),
							skippedNoToken: z.number(),
						}),
					}),
				},
			},
		},
		401: { description: 'Missing or invalid heartbeat secret' },
	},
})

export const heartbeatRoutes = new OpenAPIHono().openapi(route, async c => {
	const { heartbeatSecret, metaMode, buildMetaClient } = getHeartbeatDependencies()
	if (c.req.header('authorization') !== `Bearer ${heartbeatSecret}`) return c.text('Несанкціонований доступ', 401)
	const result = await runHeartbeat({ metaMode, buildMetaClient })
	return c.json({ ok: true as const, ...result }, 200)
})
