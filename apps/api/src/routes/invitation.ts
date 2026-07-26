import { Hono } from 'hono'

import { apiError } from '../logic/apiError'

export const invitationRoutes = new Hono()

invitationRoutes.get('/accept', c => {
	const id = c.req.query('id')
	if (!id) return apiError(c, 'BAD_REQUEST', { message: 'Некоректне посилання на запрошення' })

	const clientUrl = process.env.CLIENT_URL
	if (clientUrl) {
		return c.redirect(`${clientUrl}/sign-up`)
	}

	return c.text('Відкрийте Adomata, щоб зареєструватися та прийняти запрошення.')
})
