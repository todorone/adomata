export type MetaConfig = {
	mode: 'fake' | 'live'
	accessToken: string
}

type MetaEnvironment = Record<string, string | undefined>

export function parseMetaConfig(environment: MetaEnvironment = process.env): MetaConfig {
	const mode = environment.META_API_MODE?.trim()
	if (mode !== 'fake' && mode !== 'live') {
		throw new Error('META_API_MODE must be either "fake" or "live"')
	}

	const accessToken = environment.META_ACCESS_TOKEN?.trim()
	return { mode, accessToken: accessToken || 'fake-meta-access-token' }
}

export function requireHeartbeatSecret(environment: MetaEnvironment = process.env) {
	const heartbeatSecret = environment.HEARTBEAT_SECRET?.trim()
	if (!heartbeatSecret) throw new Error('HEARTBEAT_SECRET must be set')
	return heartbeatSecret
}
