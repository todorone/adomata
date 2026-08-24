import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaClient } from '../meta/client'
import { configureHeartbeat } from '../sync/runtime'

const sync = vi.hoisted(() => ({
	scheduleAccountDataRunsForAgencies: vi.fn(),
	scheduleHierarchyRunsForAgencies: vi.fn(),
	scheduleInsightsRunsForAgencies: vi.fn(),
	scheduleCreativeRunsForAgencies: vi.fn(),
}))

vi.mock('../sync/account-data', () => ({ scheduleAccountDataRunsForAgencies: sync.scheduleAccountDataRunsForAgencies }))
vi.mock('../sync/hierarchy', () => ({ scheduleHierarchyRunsForAgencies: sync.scheduleHierarchyRunsForAgencies }))
vi.mock('../sync/insights', () => ({ scheduleInsightsRunsForAgencies: sync.scheduleInsightsRunsForAgencies }))
vi.mock('../sync/creative', () => ({ scheduleCreativeRunsForAgencies: sync.scheduleCreativeRunsForAgencies }))

const { heartbeatRoutes } = await import('./heartbeat')

describe('POST /heartbeat', () => {
	beforeEach(() => {
		sync.scheduleAccountDataRunsForAgencies.mockReset()
		sync.scheduleHierarchyRunsForAgencies.mockReset()
		sync.scheduleInsightsRunsForAgencies.mockReset()
		sync.scheduleCreativeRunsForAgencies.mockReset()
		sync.scheduleAccountDataRunsForAgencies.mockResolvedValue([
			{ runId: 'run_1', status: 'completed', processed: 2, failed: 1, skipped: 0, queued: 0 },
		])
		sync.scheduleHierarchyRunsForAgencies.mockResolvedValue([])
		sync.scheduleInsightsRunsForAgencies.mockResolvedValue([])
		sync.scheduleCreativeRunsForAgencies.mockResolvedValue([])
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
		expect(sync.scheduleHierarchyRunsForAgencies).toHaveBeenCalledWith({
			trigger: 'cron',
			metaMode: 'fake',
			buildMetaClient: expect.any(Function),
		})
		expect(sync.scheduleInsightsRunsForAgencies).toHaveBeenCalledWith({
			trigger: 'cron',
			metaMode: 'fake',
			buildMetaClient: expect.any(Function),
		})
		expect(sync.scheduleCreativeRunsForAgencies).toHaveBeenCalledWith({
			trigger: 'cron',
			metaMode: 'fake',
			buildMetaClient: expect.any(Function),
		})
	})

	it('keeps Account data scheduling independent when hierarchy scheduling fails', async () => {
		const runs = [{ runId: 'run_1', status: 'completed', processed: 2, failed: 1, skipped: 0, queued: 0 }]
		let finishAccountData: ((value: typeof runs) => void) | undefined
		sync.scheduleAccountDataRunsForAgencies.mockReturnValue(
			new Promise(resolve => {
				finishAccountData = resolve
			}),
		)
		sync.scheduleHierarchyRunsForAgencies.mockRejectedValue(new Error('hierarchy scheduler unavailable'))

		const responsePromise = heartbeatRoutes.request('/', {
			method: 'POST',
			headers: { Authorization: 'Bearer heartbeat-secret' },
		})
		expect(sync.scheduleHierarchyRunsForAgencies).toHaveBeenCalled()

		finishAccountData?.(runs)
		const response = await responsePromise
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({ ok: true, accountData: { processed: 2, failed: 1 } })
	})
})
