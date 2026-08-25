import './core/telemetry'
import { MetaClient } from './meta/client'
import { parseMetaConfig, requireSchedulerSecret } from './meta/config'
import { configureScheduler } from './sync/runtime'

const metaConfig = parseMetaConfig()
const schedulerSecret = requireSchedulerSecret()

if (metaConfig.mode === 'fake') {
	const { fakeMetaServer, rejectUnhandledMetaRequest } = await import('./meta/fake/server')
	fakeMetaServer.listen({ onUnhandledRequest: rejectUnhandledMetaRequest })
}

configureScheduler({
	schedulerSecret,
	metaMode: metaConfig.mode,
	buildMetaClient: accessToken => {
		if (metaConfig.mode === 'fake') return new MetaClient({ accessToken: metaConfig.accessToken })
		if (!accessToken) throw new Error('Meta live mode requires a resolved Agency access token')
		return new MetaClient({ accessToken })
	},
})

const { app } = await import('./app')

const port = Number(process.env.PORT)
if (!Number.isInteger(port) || port <= 0) {
	throw new Error('PORT must be a positive integer')
}

export default {
	port,
	fetch: app.fetch,
}
