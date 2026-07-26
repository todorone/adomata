import './core/telemetry'
import { parseMetaConfig, requireHeartbeatSecret } from './meta/config'

const metaConfig = parseMetaConfig()
requireHeartbeatSecret()

if (metaConfig.mode === 'fake') {
	const { fakeMetaServer } = await import('./meta/fake/server')
	fakeMetaServer.listen({ onUnhandledRequest: 'bypass' })
}

const { app } = await import('./app')

const port = Number(process.env.PORT)
if (!Number.isInteger(port) || port <= 0) {
	throw new Error('PORT must be a positive integer')
}

export default {
	port,
	fetch: app.fetch,
}
