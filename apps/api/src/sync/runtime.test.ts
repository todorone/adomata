import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaClient } from '../meta/client'

const sync = vi.hoisted(() => ({
	scheduleAccountDataRunsForAgencies: vi.fn(),
	scheduleAccountDataRun: vi.fn(),
	scheduleHierarchyRunsForAgencies: vi.fn(),
	scheduleHierarchyRun: vi.fn(),
	scheduleInsightsRunsForAgencies: vi.fn(),
	scheduleInsightsRun: vi.fn(),
	scheduleCreativeRunsForAgencies: vi.fn(),
	scheduleCreativeRun: vi.fn(),
	scheduleHistoricalReconciliationRunsForAgencies: vi.fn(),
	resumeForceRefreshes: vi.fn(),
}))

vi.mock('./account-data', () => ({
	scheduleAccountDataRunsForAgencies: sync.scheduleAccountDataRunsForAgencies,
	scheduleAccountDataRun: sync.scheduleAccountDataRun,
}))
vi.mock('./hierarchy', () => ({
	scheduleHierarchyRunsForAgencies: sync.scheduleHierarchyRunsForAgencies,
	scheduleHierarchyRun: sync.scheduleHierarchyRun,
}))
vi.mock('./insights', () => ({
	scheduleInsightsRunsForAgencies: sync.scheduleInsightsRunsForAgencies,
	scheduleInsightsRun: sync.scheduleInsightsRun,
}))
vi.mock('./creative', () => ({
	scheduleCreativeRunsForAgencies: sync.scheduleCreativeRunsForAgencies,
	scheduleCreativeRun: sync.scheduleCreativeRun,
}))
vi.mock('./historical-reconciliation', () => ({
	scheduleHistoricalReconciliationRunsForAgencies: sync.scheduleHistoricalReconciliationRunsForAgencies,
}))
vi.mock('./force-refresh', () => ({ resumeForceRefreshes: sync.resumeForceRefreshes }))

const { configureScheduler, triggerAgencyBackgroundSync, triggerBackgroundSync } = await import('./runtime')

describe('triggerBackgroundSync', () => {
	beforeEach(() => {
		for (const scheduler of Object.values(sync)) scheduler.mockReset().mockResolvedValue([])
	})

	it('does nothing when scheduler dependencies are not configured', () => {
		expect(() => triggerBackgroundSync()).not.toThrow()
		for (const scheduler of Object.values(sync)) expect(scheduler).not.toHaveBeenCalled()
	})

	it('fires every Operational Slice and Creative enrichment before reconciliation', async () => {
		const buildMetaClient = () => new MetaClient({ accessToken: 'test-token' })
		configureScheduler({ schedulerSecret: 'secret', metaMode: 'fake', buildMetaClient })

		await triggerBackgroundSync()

		for (const scheduler of [
			sync.scheduleAccountDataRunsForAgencies,
			sync.scheduleHierarchyRunsForAgencies,
			sync.scheduleInsightsRunsForAgencies,
			sync.scheduleCreativeRunsForAgencies,
			sync.scheduleHistoricalReconciliationRunsForAgencies,
		]) {
			expect(scheduler).toHaveBeenCalledWith({ trigger: 'cron', metaMode: 'fake', buildMetaClient })
		}
	})

	it('joins a second background cycle while the first is in flight', async () => {
		const buildMetaClient = () => new MetaClient({ accessToken: 'test-token' })
		configureScheduler({ schedulerSecret: 'secret', metaMode: 'fake', buildMetaClient })
		let finishAccountData: (() => void) | undefined
		sync.scheduleAccountDataRunsForAgencies.mockImplementation(
			() => new Promise<void>(resolve => (finishAccountData = resolve)),
		)

		const first = triggerBackgroundSync()
		const second = triggerBackgroundSync()

		expect(second).toBe(first)
		for (const scheduler of [
			sync.scheduleAccountDataRunsForAgencies,
			sync.scheduleHierarchyRunsForAgencies,
			sync.scheduleInsightsRunsForAgencies,
			sync.scheduleCreativeRunsForAgencies,
		]) {
			expect(scheduler).toHaveBeenCalledOnce()
		}

		finishAccountData?.()
		await first

		expect(sync.scheduleHistoricalReconciliationRunsForAgencies).toHaveBeenCalledOnce()
	})

	it('swallows a rejected slice scheduler instead of throwing', async () => {
		sync.scheduleInsightsRunsForAgencies.mockRejectedValue(new Error('boom'))
		configureScheduler({
			schedulerSecret: 'secret',
			metaMode: 'fake',
			buildMetaClient: () => new MetaClient({ accessToken: 'test-token' }),
		})

		expect(() => triggerBackgroundSync()).not.toThrow()
		await triggerBackgroundSync()
	})

	it('runs pending Force Refreshes before Historical Reconciliation', async () => {
		const buildMetaClient = () => new MetaClient({ accessToken: 'test-token' })
		configureScheduler({ schedulerSecret: 'secret', metaMode: 'fake', buildMetaClient })
		let resume: (() => void) | undefined
		sync.resumeForceRefreshes.mockImplementation(() => new Promise<void>(resolve => (resume = resolve)))

		triggerBackgroundSync()
		await new Promise(resolve => setTimeout(resolve, 0))

		expect(sync.resumeForceRefreshes).toHaveBeenCalledWith({ metaMode: 'fake', buildMetaClient })
		expect(sync.scheduleHistoricalReconciliationRunsForAgencies).not.toHaveBeenCalled()
		resume?.()
		await new Promise(resolve => setTimeout(resolve, 0))

		expect(sync.scheduleHistoricalReconciliationRunsForAgencies).toHaveBeenCalledWith({
			trigger: 'cron',
			metaMode: 'fake',
			buildMetaClient,
		})
	})

	it('waits for Account data and hierarchy before starting Initial Import insights', async () => {
		const buildMetaClient = () => new MetaClient({ accessToken: 'test-token' })
		configureScheduler({ schedulerSecret: 'secret', metaMode: 'fake', buildMetaClient })
		let finishAccountData: (() => void) | undefined
		let finishHierarchy: (() => void) | undefined
		sync.scheduleAccountDataRun.mockImplementation(() => new Promise<void>(resolve => (finishAccountData = resolve)))
		sync.scheduleHierarchyRun.mockImplementation(() => new Promise<void>(resolve => (finishHierarchy = resolve)))

		triggerAgencyBackgroundSync('agency_1', 'connect')
		await Promise.resolve()

		expect(sync.scheduleInsightsRun).not.toHaveBeenCalled()
		finishAccountData?.()
		finishHierarchy?.()
		await new Promise(resolve => setTimeout(resolve, 0))

		expect(sync.scheduleInsightsRun).toHaveBeenCalledWith({
			agencyId: 'agency_1',
			trigger: 'connect',
			metaMode: 'fake',
			buildMetaClient,
		})
	})
})
