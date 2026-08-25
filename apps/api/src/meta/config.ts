export type MetaConfig = {
	mode: 'fake' | 'live'
	accessToken: string
}

type MetaEnvironment = Record<string, string | undefined>

export function parseMetaConfig(environment: MetaEnvironment = process.env): MetaConfig {
	const mode = environment.META_API_MODE?.trim() === 'fake' ? 'fake' : 'live'

	const accessToken = environment.META_ACCESS_TOKEN?.trim()
	return { mode, accessToken: accessToken || 'fake-meta-access-token' }
}

export function requireSchedulerSecret(environment: MetaEnvironment = process.env) {
	const schedulerSecret = environment.SCHEDULER_SECRET?.trim()
	if (!schedulerSecret) throw new Error('SCHEDULER_SECRET must be set')
	return schedulerSecret
}
