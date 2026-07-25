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

// Both `invalidateQueries` and `fetchQuery` skip the network call when the
// cache already holds non-stale data — the 10 minute `staleTime` means a
// plain `fetchQuery` right after sign-in just returns the pre-sign-in cached
// value. Marking the query invalidated first (with no auto-refetch, to avoid
// racing a second background fetch) forces the following `fetchQuery` to
// treat it as stale and actually hit the network, so the cache holds the
// fresh session before this resolves.
export async function refreshCachedSession() {
	await queryClient.invalidateQueries({ queryKey: sessionKeys.current, refetchType: 'none' })
	return queryClient.fetchQuery(sessionQueries.current())
}
