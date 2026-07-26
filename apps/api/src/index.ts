import './core/telemetry'
import { MetaClient } from './meta/client'
import { parseMetaConfig, requireHeartbeatSecret } from './meta/config'
import { configureHeartbeat } from './sync/runtime'

const metaConfig = parseMetaConfig()
const heartbeatSecret = requireHeartbeatSecret()

if (metaConfig.mode === 'fake') {
	const { fakeMetaServer, rejectUnhandledMetaRequest } = await import('./meta/fake/server')
	fakeMetaServer.listen({ onUnhandledRequest: rejectUnhandledMetaRequest })
}

configureHeartbeat({ metaClient: new MetaClient({ accessToken: metaConfig.accessToken }), heartbeatSecret })

const { app } = await import('./app')

const port = Number(process.env.PORT)
if (!Number.isInteger(port) || port <= 0) {
	throw new Error('PORT must be a positive integer')
}

export default {
	port,
	fetch: app.fetch,
}
