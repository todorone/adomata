import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

import { getHeartbeatDependencies, triggerBackgroundSync } from '../sync/runtime'

const route = createRoute({
	method: 'post',
	path: '/',
	responses: {
		200: {
			description: 'Heartbeat accepted; sync work continues in the background',
			content: {
				'application/json': {
					schema: z.object({ ok: z.literal(true), started: z.literal(true) }),
				},
			},
		},
		401: { description: 'Missing or invalid heartbeat secret' },
	},
})

export const heartbeatRoutes = new OpenAPIHono().openapi(route, async c => {
	const { heartbeatSecret } = getHeartbeatDependencies()
	if (c.req.header('authorization') !== `Bearer ${heartbeatSecret}`) return c.text('Несанкціонований доступ', 401)
	triggerBackgroundSync()
	return c.json({ ok: true as const, started: true as const }, 200)
})
