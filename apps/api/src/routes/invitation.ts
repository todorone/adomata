import { Hono } from 'hono'

import { apiError } from '../logic/apiError'

export const invitationRoutes = new Hono()

invitationRoutes.get('/accept', c => {
	const id = c.req.query('id')
	if (!id) return apiError(c, 'BAD_REQUEST', { message: 'Invalid invitation link' })

	// TODO: client doesn't have an /accept-invitation screen yet — build one that calls
	// authClient.organization.acceptInvitation({ invitationId }) and then routes into login/signup.
	const clientUrl = process.env.CLIENT_URL
	if (clientUrl) {
		return c.redirect(`${clientUrl}/accept-invitation?id=${encodeURIComponent(id)}`)
	}

	return c.text(`Open Adomata and enter invitation code: ${id}`)
})
