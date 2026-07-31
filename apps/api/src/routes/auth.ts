import { Hono } from 'hono'
import { z } from 'zod'

import { canSignUpWithEmail, createAuth } from '../logic/auth'
import { apiError } from '../logic/apiError'

const signUpEmailSchema = z.object({
	email: z.email(),
})

export const authRoutes = new Hono()

authRoutes.post('/sign-up/email', async c => {
	const body = await c.req.json()
	const parsed = signUpEmailSchema.safeParse(body)
	if (!parsed.success) return apiError(c, 'BAD_REQUEST', { message: 'Invalid request', details: parsed.error.issues })

	if (!(await canSignUpWithEmail(parsed.data.email))) {
		return apiError(c, 'FORBIDDEN', { message: 'Registration requires an invitation' })
	}

	const response = await createAuth().handler(
		new Request(c.req.raw.url, {
			method: c.req.raw.method,
			headers: c.req.raw.headers,
			body: JSON.stringify(body),
		}),
	)

	return response
})

authRoutes.on(['GET', 'POST'], '/*', c => createAuth().handler(c.req.raw))
