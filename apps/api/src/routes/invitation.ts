import { Hono } from 'hono'

import type { Bindings } from '../index'

export const invitationRoutes = new Hono<Bindings>()

invitationRoutes.get('/accept', c => {
	const id = c.req.query('id')
	if (!id) return c.text('Invalid invitation link', 400)

	// TODO: dashboard doesn't have an /accept-invitation screen yet — build one that calls
	// authClient.organization.acceptInvitation({ invitationId }) and then routes into login/signup.
	const dashboardUrl = (c.env as Env & { DASHBOARD_URL?: string }).DASHBOARD_URL
	if (dashboardUrl) {
		return c.redirect(`${dashboardUrl}/accept-invitation?id=${encodeURIComponent(id)}`)
	}

	return c.text(`Open Adomata and enter invitation code: ${id}`)
})
