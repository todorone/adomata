import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

import { scheduleAccountDataRunsForAgencies } from '../sync/account-data'
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
						accountData: z.object({
							processed: z.number(),
							failed: z.number(),
							skipped: z.number(),
							queued: z.number(),
						}),
						runs: z.array(
							z.object({
								runId: z.string(),
								status: z.enum(['queued', 'running', 'completed', 'failed']),
								processed: z.number(),
								failed: z.number(),
								queued: z.number(),
							}),
						),
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
	const runs = await scheduleAccountDataRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient })
	const accountData = runs.reduce(
		(counts, run) => ({
			processed: counts.processed + run.processed,
			failed: counts.failed + run.failed,
			skipped: counts.skipped + run.skipped,
			queued: counts.queued + run.queued,
		}),
		{ processed: 0, failed: 0, skipped: 0, queued: 0 },
	)
	return c.json({ ok: true as const, accountData, runs }, 200)
})
