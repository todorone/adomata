import './core/telemetry'
import { app } from './app'

const port = Number(process.env.PORT)
if (!Number.isInteger(port) || port <= 0) {
	throw new Error('PORT must be a positive integer')
}

export default {
	port,
	fetch: app.fetch,
}
