import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'

// Bearer-token auth for a cross-origin SPA: the API enables the better-auth
// `bearer()` plugin and returns the session token in the `set-auth-token`
// response header. We persist it and attach it as `Authorization: Bearer ...`
// on every request, since the client and API run on separate origins and
// better-auth's own fetch calls default to `credentials: 'same-origin'`.
const TOKEN_KEY = 'adomata.bearer_token'

export function getStoredToken() {
	return localStorage.getItem(TOKEN_KEY)
}

export function clearStoredToken() {
	localStorage.removeItem(TOKEN_KEY)
}

export const authClient = createAuthClient({
	baseURL: (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000',
	basePath: '/auth',
	plugins: [organizationClient()],
	fetchOptions: {
		auth: {
			type: 'Bearer',
			token: () => getStoredToken() ?? '',
		},
		onSuccess: ctx => {
			const token = ctx.response.headers.get('set-auth-token')
			if (token) localStorage.setItem(TOKEN_KEY, token)
		},
	},
})

export type Session = typeof authClient.$Infer.Session
