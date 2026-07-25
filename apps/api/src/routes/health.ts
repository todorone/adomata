import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

import { db } from '../db'
import { organization } from '../db/schema'
import { logger } from '../core/logger'
import { apiError } from '../logic/apiError'
import { apiErrorSchema } from '../client/error'

export const healthOkSchema = z.object({ ok: z.literal(true), db: z.literal('up') }).openapi('HealthOk')

const route = createRoute({
	method: 'get',
	path: '/',
	responses: {
		200: { description: 'OK', content: { 'application/json': { schema: healthOkSchema } } },
		503: { description: 'Database unavailable', content: { 'application/json': { schema: apiErrorSchema } } },
	},
})

export const healthRoutes = new OpenAPIHono().openapi(route, async c => {
	try {
		await db.select({ id: organization.id }).from(organization).limit(1)
		return c.json({ ok: true, db: 'up' } as const, 200)
	} catch (err) {
		logger.error('db health check failed:', err)
		return apiError(c, 'SERVICE_UNAVAILABLE', { message: 'Database unavailable' }) as never
	}
})
