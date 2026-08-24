import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaClient } from '../meta/client'

const sync = vi.hoisted(() => ({
	scheduleAccountDataRunsForAgencies: vi.fn(),
	scheduleHierarchyRunsForAgencies: vi.fn(),
	scheduleInsightsRunsForAgencies: vi.fn(),
	scheduleCreativeRunsForAgencies: vi.fn(),
	scheduleHistoricalReconciliationRunsForAgencies: vi.fn(),
}))

vi.mock('./account-data', () => ({ scheduleAccountDataRunsForAgencies: sync.scheduleAccountDataRunsForAgencies }))
vi.mock('./hierarchy', () => ({ scheduleHierarchyRunsForAgencies: sync.scheduleHierarchyRunsForAgencies }))
vi.mock('./insights', () => ({ scheduleInsightsRunsForAgencies: sync.scheduleInsightsRunsForAgencies }))
vi.mock('./creative', () => ({ scheduleCreativeRunsForAgencies: sync.scheduleCreativeRunsForAgencies }))
vi.mock('./historical-reconciliation', () => ({
	scheduleHistoricalReconciliationRunsForAgencies: sync.scheduleHistoricalReconciliationRunsForAgencies,
}))

const { configureHeartbeat, triggerBackgroundSync } = await import('./runtime')

describe('triggerBackgroundSync', () => {
	beforeEach(() => {
		for (const scheduler of Object.values(sync)) scheduler.mockReset().mockResolvedValue([])
	})

	it('does nothing when heartbeat dependencies are not configured', () => {
		expect(() => triggerBackgroundSync()).not.toThrow()
		for (const scheduler of Object.values(sync)) expect(scheduler).not.toHaveBeenCalled()
	})

	it('fires every Operational Slice and Creative enrichment without waiting', () => {
		const buildMetaClient = () => new MetaClient({ accessToken: 'test-token' })
		configureHeartbeat({ heartbeatSecret: 'secret', metaMode: 'fake', buildMetaClient })

		triggerBackgroundSync()

		for (const scheduler of Object.values(sync)) {
			expect(scheduler).toHaveBeenCalledWith({ trigger: 'cron', metaMode: 'fake', buildMetaClient })
		}
	})

	it('swallows a rejected slice scheduler instead of throwing', async () => {
		sync.scheduleInsightsRunsForAgencies.mockRejectedValue(new Error('boom'))
		configureHeartbeat({
			heartbeatSecret: 'secret',
			metaMode: 'fake',
			buildMetaClient: () => new MetaClient({ accessToken: 'test-token' }),
		})

		expect(() => triggerBackgroundSync()).not.toThrow()
		await new Promise(resolve => setTimeout(resolve, 0))
	})
})
