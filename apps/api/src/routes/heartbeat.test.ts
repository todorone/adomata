import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaClient } from '../meta/client'
import { configureHeartbeat } from '../sync/runtime'

const sync = vi.hoisted(() => ({ scheduleAccountDataRunsForAgencies: vi.fn() }))

vi.mock('../sync/account-data', () => ({ scheduleAccountDataRunsForAgencies: sync.scheduleAccountDataRunsForAgencies }))
vi.mock('../sync/account-tier', () => ({ runHeartbeat: vi.fn() }))

const { heartbeatRoutes } = await import('./heartbeat')

describe('POST /heartbeat', () => {
	beforeEach(() => {
		sync.scheduleAccountDataRunsForAgencies.mockReset()
		sync.scheduleAccountDataRunsForAgencies.mockResolvedValue([
			{ runId: 'run_1', status: 'completed', processed: 2, failed: 1, skipped: 0, queued: 0 },
		])
		configureHeartbeat({
			heartbeatSecret: 'heartbeat-secret',
			metaMode: 'fake',
			buildMetaClient: () => new MetaClient({ accessToken: 'test-token' }),
		})
	})

	it('rejects missing and invalid bearer credentials', async () => {
		await expect(heartbeatRoutes.request('/', { method: 'POST' })).resolves.toMatchObject({ status: 401 })
		await expect(
			heartbeatRoutes.request('/', { method: 'POST', headers: { Authorization: 'Bearer wrong-secret' } }),
		).resolves.toMatchObject({ status: 401 })
		expect(sync.scheduleAccountDataRunsForAgencies).not.toHaveBeenCalled()
	})

	it('runs the heartbeat with the configured Meta client for valid credentials', async () => {
		const response = await heartbeatRoutes.request('/', {
			method: 'POST',
			headers: { Authorization: 'Bearer heartbeat-secret' },
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			ok: true,
			accountData: { processed: 2, failed: 1, skipped: 0, queued: 0 },
			runs: [{ runId: 'run_1', status: 'completed', processed: 2, failed: 1, skipped: 0, queued: 0 }],
		})
		expect(sync.scheduleAccountDataRunsForAgencies).toHaveBeenCalledWith({
			trigger: 'cron',
			metaMode: 'fake',
			buildMetaClient: expect.any(Function),
		})
	})
})
