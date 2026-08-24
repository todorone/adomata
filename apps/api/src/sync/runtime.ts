import { logger } from '../core/logger'
import type { MetaClient } from '../meta/client'
import { scheduleAccountDataRun } from './account-data'
import { runHeartbeat } from './account-tier'
import { scheduleHierarchyRun } from './hierarchy'

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
		runHeartbeat({ metaMode, buildMetaClient }).catch(error =>
			logger.warn('Background sync failed', { category: error instanceof Error ? error.name : 'unknown' }),
		)
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
