import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaClient } from '../meta/client'
import { configureScheduler } from '../sync/runtime'

const sync = vi.hoisted(() => ({
	scheduleAccountDataRunsForAgencies: vi.fn(),
	scheduleHierarchyRunsForAgencies: vi.fn(),
	scheduleInsightsRunsForAgencies: vi.fn(),
	scheduleCreativeRunsForAgencies: vi.fn(),
	scheduleHistoricalReconciliationRunsForAgencies: vi.fn(),
}))

vi.mock('../sync/account-data', () => ({ scheduleAccountDataRunsForAgencies: sync.scheduleAccountDataRunsForAgencies }))
vi.mock('../sync/hierarchy', () => ({ scheduleHierarchyRunsForAgencies: sync.scheduleHierarchyRunsForAgencies }))
vi.mock('../sync/insights', () => ({ scheduleInsightsRunsForAgencies: sync.scheduleInsightsRunsForAgencies }))
vi.mock('../sync/creative', () => ({ scheduleCreativeRunsForAgencies: sync.scheduleCreativeRunsForAgencies }))
vi.mock('../sync/historical-reconciliation', () => ({
	scheduleHistoricalReconciliationRunsForAgencies: sync.scheduleHistoricalReconciliationRunsForAgencies,
}))

const { schedulerRoutes } = await import('./scheduler')

describe('POST /scheduler', () => {
	beforeEach(() => {
		for (const scheduler of Object.values(sync)) scheduler.mockReset().mockResolvedValue([])
		sync.scheduleAccountDataRunsForAgencies.mockResolvedValue([
			{ runId: 'run_1', status: 'completed', processed: 2, failed: 1, skipped: 0, queued: 0 },
		])
		configureScheduler({
			schedulerSecret: 'scheduler-secret',
			metaMode: 'fake',
			buildMetaClient: () => new MetaClient({ accessToken: 'test-token' }),
		})
	})

	it('rejects missing and invalid bearer credentials', async () => {
		await expect(schedulerRoutes.request('/', { method: 'POST' })).resolves.toMatchObject({ status: 401 })
		await expect(
			schedulerRoutes.request('/', { method: 'POST', headers: { Authorization: 'Bearer wrong-secret' } }),
		).resolves.toMatchObject({ status: 401 })
		expect(sync.scheduleAccountDataRunsForAgencies).not.toHaveBeenCalled()
	})

	it('creates or joins every durable slice with configured Meta access', async () => {
		const response = await schedulerRoutes.request('/', {
			method: 'POST',
			headers: { Authorization: 'Bearer scheduler-secret' },
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			ok: true,
			accountData: { processed: 2, failed: 1, skipped: 0, queued: 0 },
			runs: [{ runId: 'run_1', status: 'completed', processed: 2, failed: 1, skipped: 0, queued: 0 }],
		})
		for (const scheduler of Object.values(sync)) {
			expect(scheduler).toHaveBeenCalledWith({
				trigger: 'cron',
				metaMode: 'fake',
				buildMetaClient: expect.any(Function),
			})
		}
	})
})
