import { hc } from 'hono/client'
import type { AppType } from '@adomata/api/client'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787'

export const api = hc<AppType>(API_URL, {
	fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, credentials: 'include' }),
})
