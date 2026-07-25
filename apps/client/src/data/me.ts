import { queryOptions, useQuery } from '@tanstack/react-query'
import { meResponseSchema } from '@adomata/api/client'

import { api } from './core/apiClient'
import { parseResponse } from './core/apiFetch'

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
