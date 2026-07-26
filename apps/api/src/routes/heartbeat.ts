import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

import { requireHeartbeatSecret } from '../meta/config'
import { runHeartbeat } from '../sync/account-tier'

const route = createRoute({
	method: 'post',
	path: '/',
	responses: {
		200: {
			description: 'Heartbeat completed',
			content: {
				'application/json': {
					schema: z.object({ ok: z.literal(true), skipped: z.boolean(), processed: z.number() }),
				},
			},
		},
		401: { description: 'Missing or invalid heartbeat secret' },
	},
})

export const heartbeatRoutes = new OpenAPIHono().openapi(route, async c => {
	if (c.req.header('authorization') !== `Bearer ${requireHeartbeatSecret()}`)
		return c.text('Несанкціонований доступ', 401)
	const result = await runHeartbeat()
	return c.json({ ok: true as const, ...result }, 200)
})
