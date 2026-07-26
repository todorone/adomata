import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { httpInstrumentationMiddleware } from '@hono/otel'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { cors } from 'hono/cors'

import { adminRoutes } from './routes/admin'
import { authRoutes } from './routes/auth'
import { healthRoutes } from './routes/health'
import { invitationRoutes } from './routes/invitation'
import { meRoutes } from './routes/me'
import { apiError } from './logic/apiError'
import { logger } from './core/logger'

function isAllowedOrigin(origin: string) {
	try {
		const { hostname } = new URL(origin)
		return hostname === 'localhost' || hostname.endsWith('.adomata.com')
	} catch {
		return false
	}
}

const base = new OpenAPIHono({
	defaultHook: (result, c) => {
		if (!result.success) return apiError(c, 'BAD_REQUEST', { details: result.error.issues })
	},
})

base.use(
	cors({
		origin: origin => (isAllowedOrigin(origin) ? origin : null),
		credentials: true,
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
		allowHeaders: ['Content-Type', 'Authorization', 'x-skip-oauth-proxy'],
		exposeHeaders: ['set-auth-token'],
		maxAge: 600,
	}),
)

// No-op outside production: the global TracerProvider only exports spans once
// core/telemetry.ts calls NodeSDK#start(), which is gated on NODE_ENV.
base.use(httpInstrumentationMiddleware())

base.onError((err, c) => {
	trace.getActiveSpan()?.recordException(err)
	trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
	logger.error('Unhandled error:', err)
	return apiError(c, 'INTERNAL')
})

if (process.env.NODE_ENV !== 'production') {
	base.doc('/doc', {
		openapi: '3.1.0',
		info: { title: 'Adomata API', version: '1.0.0' },
	})
	base.get('/ui', swaggerUI({ url: '/doc' }))
}

const withHealthRoutes = base.route('/health', healthRoutes)
const withAuthRoutes = withHealthRoutes.route('/auth', authRoutes)
const withMeRoutes = withAuthRoutes.route('/me', meRoutes)
const withAdminRoutes = withMeRoutes.route('/admin', adminRoutes)
const withInvitationRoutes = withAdminRoutes.route('/invitation', invitationRoutes)
export const app = withInvitationRoutes.get('/', c => c.text('🟢 api works'))
