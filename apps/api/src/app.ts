import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { adminRoutes } from './routes/admin'
import { authRoutes } from './routes/auth'
import { invitationRoutes } from './routes/invitation'
import { meRoutes } from './routes/me'

function isAllowedOrigin(origin: string) {
	try {
		const { hostname } = new URL(origin)
		return hostname === 'localhost' || hostname.endsWith('.adomata.com')
	} catch {
		return false
	}
}

const hono = new Hono()

hono.use(
	cors({
		origin: origin => (isAllowedOrigin(origin) ? origin : null),
		credentials: true,
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
		allowHeaders: ['Content-Type', 'Authorization', 'x-skip-oauth-proxy'],
		maxAge: 600,
	}),
)

const withAuthRoutes = hono.route('/auth', authRoutes)
const withMeRoutes = withAuthRoutes.route('/me', meRoutes)
const withAdminRoutes = withMeRoutes.route('/admin', adminRoutes)
const withInvitationRoutes = withAdminRoutes.route('/invitation', invitationRoutes)
export const app = withInvitationRoutes.get('/', c => c.text('🟢 api works'))
