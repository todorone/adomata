import { queryOptions, useQuery } from '@tanstack/react-query'
import { redirect } from '@tanstack/react-router'

import { authClient } from '@/lib/auth-client'
import { queryClient } from './core/queryClient'

export const sessionKeys = {
	current: ['session'] as const,
}

export const sessionQueries = {
	current: () =>
		queryOptions({
			queryKey: sessionKeys.current,
			queryFn: () => authClient.getSession(),
		}),
}

export function useSession() {
	return useQuery(sessionQueries.current())
}

export async function getCachedSession() {
	return queryClient.ensureQueryData(sessionQueries.current())
}

export async function requireSession() {
	const session = await getCachedSession()
	if (!session.data) {
		throw redirect({ to: '/login' })
	}
	return session.data
}

export async function redirectAuthenticatedUser() {
	const session = await getCachedSession()
	if (session.data) {
		throw redirect({ to: '/' })
	}
}

export function clearCachedSession() {
	queryClient.removeQueries({ queryKey: sessionKeys.current })
}

export function refreshCachedSession() {
	return queryClient.invalidateQueries({ queryKey: sessionKeys.current })
}
