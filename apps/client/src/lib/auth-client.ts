import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'

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
