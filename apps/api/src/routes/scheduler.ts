import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

import { getSchedulerDependencies, triggerBackgroundSync } from '../sync/runtime'

const route = createRoute({
	method: 'post',
	path: '/',
	responses: {
		200: {
			description: 'Routine work accepted; it continues in the background',
			content: {
				'application/json': {
					schema: z.object({ ok: z.literal(true), started: z.literal(true) }),
				},
			},
		},
		401: { description: 'Missing or invalid scheduler secret' },
	},
})

export const schedulerRoutes = new OpenAPIHono().openapi(route, async c => {
	const { schedulerSecret } = getSchedulerDependencies()
	if (c.req.header('authorization') !== `Bearer ${schedulerSecret}`) return c.text('Несанкціонований доступ', 401)
	triggerBackgroundSync()
	return c.json({ ok: true as const, started: true as const }, 200)
})
