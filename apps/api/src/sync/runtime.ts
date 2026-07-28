import type { MetaClient } from '../meta/client'

type HeartbeatDependencies = {
	heartbeatSecret: string
	metaMode: 'fake' | 'live'
	// Encapsulates the fake-mode-placeholder-vs-live-mode-token branching, so
	// callers never need to parse META_API_MODE themselves. In live mode,
	// accessToken must be a per-Agency token resolved from organizationSettings.
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
