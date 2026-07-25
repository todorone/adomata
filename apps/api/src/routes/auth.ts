import { Hono } from 'hono'
import { z } from 'zod'

import { activateInvitedOrganization, canSignUpWithEmail, createAuth } from '../logic/auth'

const signUpEmailSchema = z.object({
	email: z.email(),
})

export const authRoutes = new Hono()

authRoutes.post('/sign-up/email', async c => {
	const body = await c.req.json()
	const parsed = signUpEmailSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: 'Invalid request' }, 400)

	if (!(await canSignUpWithEmail(parsed.data.email))) {
		return c.json({ error: 'Registration requires an invitation' }, 403)
	}

	const response = await createAuth().handler(
		new Request(c.req.raw.url, {
			method: c.req.raw.method,
			headers: c.req.raw.headers,
			body: JSON.stringify(body),
		}),
	)

	if (response.ok) {
		const clone = response.clone()
		const payload = (await clone.json().catch(() => null)) as { token?: string } | null
		if (payload?.token) {
			await activateInvitedOrganization(parsed.data.email, payload.token)
		}
	}

	return response
})

authRoutes.on(['GET', 'POST'], '/*', c => createAuth().handler(c.req.raw))
