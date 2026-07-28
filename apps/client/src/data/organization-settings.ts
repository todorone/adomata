import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { organizationSettingsResponseSchema, type UpdateOrganizationSettingsBody } from '@adomata/api/client'

import { api } from './core/apiClient'
import { parseResponse } from './core/apiFetch'

export const organizationSettingsKeys = {
	current: ['organization-settings'] as const,
}

export const organizationSettingsQueries = {
	current: (enabled = true) =>
		queryOptions({
			queryKey: organizationSettingsKeys.current,
			queryFn: async () =>
				parseResponse(
					await api['organization-settings'].$get(),
					organizationSettingsResponseSchema,
					'GET /organization-settings',
				),
			enabled,
		}),
}

export function useOrganizationSettings(enabled = true) {
	return useQuery(organizationSettingsQueries.current(enabled))
}

export function useUpdateOrganizationSettings() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: async (body: UpdateOrganizationSettingsBody) =>
			parseResponse(
				await api['organization-settings'].$put({ json: body }),
				organizationSettingsResponseSchema,
				'PUT /organization-settings',
			),
		onSuccess: () => qc.invalidateQueries({ queryKey: organizationSettingsKeys.current }),
	})
}
