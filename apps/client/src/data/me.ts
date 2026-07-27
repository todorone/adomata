import { queryOptions, useMutation, useQuery } from '@tanstack/react-query'
import { meResponseSchema } from '@adomata/api/client'

import { api } from './core/apiClient'
import { parseNoContent, parseResponse } from './core/apiFetch'

export const meKeys = {
	current: ['me'] as const,
}

export const meQueries = {
	current: (enabled = true) =>
		queryOptions({
			queryKey: meKeys.current,
			queryFn: async () => parseResponse(await api.me.$get(), meResponseSchema, 'GET /me'),
			enabled,
		}),
}

export function useMe(enabled = true) {
	return useQuery(meQueries.current(enabled))
}

// A full reload drops every Agency-scoped query from memory before the new
// Agency renders, rather than relying on each future query to be invalidated.
export function useSwitchAgency() {
	return useMutation({
		mutationFn: async (organizationId: string) =>
			parseNoContent(
				await api.me['active-organization'].$post({ json: { organizationId } }),
				'POST /me/active-organization',
			),
		onSuccess: () => window.location.assign('/'),
	})
}
