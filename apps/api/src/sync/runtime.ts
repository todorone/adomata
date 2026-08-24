import { logger } from '../core/logger'
import type { MetaClient } from '../meta/client'
import { scheduleAccountDataRun, scheduleAccountDataRunsForAgencies } from './account-data'
import { scheduleCreativeRun, scheduleCreativeRunsForAgencies } from './creative'
import { scheduleHistoricalReconciliationRunsForAgencies } from './historical-reconciliation'
import { scheduleHierarchyRun, scheduleHierarchyRunsForAgencies } from './hierarchy'
import { scheduleInsightsRun, scheduleInsightsRunsForAgencies } from './insights'

type HeartbeatDependencies = {
	heartbeatSecret: string
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
}

let heartbeatDependencies: HeartbeatDependencies | undefined

export function configureHeartbeat(dependencies: HeartbeatDependencies) {
	heartbeatDependencies = dependencies
}

export function getHeartbeatDependencies() {
	if (!heartbeatDependencies) throw new Error('Heartbeat dependencies have not been configured')
	return heartbeatDependencies
}

export function triggerBackgroundSync() {
	try {
		const { metaMode, buildMetaClient } = getHeartbeatDependencies()
		Promise.allSettled([
			scheduleAccountDataRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient }),
			scheduleHierarchyRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient }),
			scheduleInsightsRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient }),
			scheduleCreativeRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient }),
			scheduleHistoricalReconciliationRunsForAgencies({ trigger: 'cron', metaMode, buildMetaClient }),
		]).then(results => {
			for (const result of results) {
				if (result.status === 'rejected')
					logger.warn('Background sync failed', {
						category: result.reason instanceof Error ? result.reason.name : 'unknown',
					})
			}
		})
	} catch {
		// Runtime configuration is intentionally absent in isolated API route tests.
	}
}

export function triggerAgencyBackgroundSync(agencyId: string, trigger: 'connect' | 'manual' = 'connect') {
	try {
		const { metaMode, buildMetaClient } = getHeartbeatDependencies()
		Promise.all([
			scheduleAccountDataRun({ agencyId, trigger, metaMode, buildMetaClient }),
			scheduleHierarchyRun({ agencyId, trigger, metaMode, buildMetaClient }),
			scheduleInsightsRun({ agencyId, trigger, metaMode, buildMetaClient }),
			scheduleCreativeRun({ agencyId, trigger, metaMode, buildMetaClient }),
		]).catch(error =>
			logger.warn('Durable operational slice scheduling failed', {
				agencyId,
				category: error instanceof Error ? error.name : 'unknown',
			}),
		)
	} catch {
		// Runtime configuration is intentionally absent in isolated API route tests.
	}
}
