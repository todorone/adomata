import type { MetaClient } from '../meta/client'

type HeartbeatDependencies = {
	metaClient: MetaClient
	heartbeatSecret: string
}

let heartbeatDependencies: HeartbeatDependencies | undefined

export function configureHeartbeat(dependencies: HeartbeatDependencies) {
	heartbeatDependencies = dependencies
}

export function getHeartbeatDependencies() {
	if (!heartbeatDependencies) throw new Error('Heartbeat dependencies have not been configured')
	return heartbeatDependencies
}
