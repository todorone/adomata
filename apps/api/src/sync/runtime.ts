import { logger } from '../core/logger'
import type { MetaClient } from '../meta/client'
import { scheduleAccountDataRun, scheduleAccountDataRunsForAgencies } from './account-data'
import { scheduleCreativeRun, scheduleCreativeRunsForAgencies } from './creative'
import { scheduleHistoricalReconciliationRunsForAgencies } from './historical-reconciliation'
import { scheduleHierarchyRun, scheduleHierarchyRunsForAgencies } from './hierarchy'
import { scheduleInsightsRun, scheduleInsightsRunsForAgencies } from './insights'

type SchedulerDependencies = {
	schedulerSecret: string
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
}

let schedulerDependencies: SchedulerDependencies | undefined
let activeBackgroundSync: Promise<void> | undefined

export function configureScheduler(dependencies: SchedulerDependencies) {
	schedulerDependencies = dependencies
}

export function getSchedulerDependencies() {
	if (!schedulerDependencies) throw new Error('Scheduler dependencies have not been configured')
	return schedulerDependencies
}

export function triggerBackgroundSync() {
	if (activeBackgroundSync) return activeBackgroundSync

	let dependencies: SchedulerDependencies
	try {
		dependencies = getSchedulerDependencies()
	} catch {
		// Runtime configuration is intentionally absent in isolated API route tests.
		return
	}

	const { metaMode, buildMetaClient } = dependencies
	const cycle = (async () => {
		const results = await Promise.allSettled([
			scheduleAccountDataRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient }),
			scheduleHierarchyRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient }),
			scheduleInsightsRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient }),
			scheduleCreativeRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient }),
		])
		for (const result of results) {
			if (result.status === 'rejected')
				logger.warn('Background sync failed', {
					category: result.reason instanceof Error ? result.reason.name : 'unknown',
				})
		}
		await triggerPendingForceRefreshes()
		try {
			await scheduleHistoricalReconciliationRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient })
		} catch (error) {
			logger.warn('Historical reconciliation scheduling failed', {
				category: error instanceof Error ? error.name : 'unknown',
			})
		} finally {
			await triggerPendingForceRefreshes()
		}
	})()

	activeBackgroundSync = cycle
	cycle
		.finally(() => {
			if (activeBackgroundSync === cycle) activeBackgroundSync = undefined
		})
		.catch(() => undefined)
	return cycle
}

export function triggerAgencyBackgroundSync(agencyId: string, trigger: 'connect' | 'manual' = 'connect') {
	try {
		const { metaMode, buildMetaClient } = getSchedulerDependencies()
		Promise.all([
			scheduleAccountDataRun({
				agencyId,
				trigger,
				metaMode,
				buildMetaClient,
			}),
			scheduleHierarchyRun({
				agencyId,
				trigger,
				metaMode,
				buildMetaClient,
			}),
		])
			.then(() => scheduleInsightsRun({ agencyId, trigger, metaMode, buildMetaClient }))
			.catch(error =>
				logger.warn('Durable operational slice scheduling failed', {
					agencyId,
					category: error instanceof Error ? error.name : 'unknown',
				}),
			)
		scheduleCreativeRun({ agencyId, trigger, metaMode, buildMetaClient }).catch(error =>
			logger.warn('Creative enrichment scheduling failed', {
				agencyId,
				category: error instanceof Error ? error.name : 'unknown',
			}),
		)
	} catch {
		// Runtime configuration is intentionally absent in isolated API route tests.
	}
}

export function triggerForceRefresh(agencyId: string, forceRefreshId: string) {
	try {
		const { metaMode, buildMetaClient } = getSchedulerDependencies()
		import('./force-refresh')
			.then(({ runForceRefresh }) => runForceRefresh({ agencyId, forceRefreshId, metaMode, buildMetaClient }))
			.catch(error =>
				logger.warn('Force Refresh execution failed', {
					agencyId,
					forceRefreshId,
					category: error instanceof Error ? error.name : 'unknown',
				}),
			)
	} catch {
		// Runtime configuration is intentionally absent in isolated API route tests.
	}
}

export async function triggerPendingForceRefreshes() {
	let dependencies: SchedulerDependencies
	try {
		dependencies = getSchedulerDependencies()
	} catch {
		// Runtime configuration is intentionally absent in isolated API route tests.
		return
	}
	try {
		const { resumeForceRefreshes } = await import('./force-refresh')
		await resumeForceRefreshes({ metaMode: dependencies.metaMode, buildMetaClient: dependencies.buildMetaClient })
	} catch (error) {
		logger.warn('Pending Force Refresh execution failed', {
			category: error instanceof Error ? error.name : 'unknown',
		})
	}
}
