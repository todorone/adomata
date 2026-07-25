import { hc } from 'hono/client'
import type { AppType } from '@adomata/api/client'

import { getStoredToken } from '@/lib/auth-client'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export const api = hc<AppType>(API_URL, {
	fetch: (input: RequestInfo | URL, init?: RequestInit) => {
		const token = getStoredToken()
		const headers = new Headers(init?.headers)
		if (token) headers.set('Authorization', `Bearer ${token}`)
		return fetch(input, { ...init, headers })
	},
})
