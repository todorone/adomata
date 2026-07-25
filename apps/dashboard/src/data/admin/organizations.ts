import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
	adminOrganizationsResponseSchema,
	createAdminOrganizationResponseSchema,
	type CreateAdminOrganizationBody,
} from '@adomata/api/client'

import { api } from '../core/apiClient'
import { parseNoContent, parseResponse } from '../core/apiFetch'

export const organizationKeys = {
	all: ['admin', 'organizations'] as const,
	list: () => organizationKeys.all,
}

export const organizationQueries = {
	list: () =>
		queryOptions({
			queryKey: organizationKeys.list(),
			queryFn: async () =>
				parseResponse(
					await api.admin.organizations.$get(),
					adminOrganizationsResponseSchema,
					'GET /admin/organizations',
				).then(r => r.organizations),
		}),
}

export function useOrganizations() {
	return useQuery(organizationQueries.list())
}

export function useCreateOrganization() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: async (body: CreateAdminOrganizationBody) =>
			parseResponse(
				await api.admin.organizations.$post({ json: body }),
				createAdminOrganizationResponseSchema,
				'POST /admin/organizations',
			),
		onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.all }),
	})
}

export function useDeleteOrganization() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: async (id: string) =>
			parseNoContent(
				await api.admin.organizations[':id'].$delete({ param: { id } }),
				'DELETE /admin/organizations/:id',
			),
		onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.all }),
	})
}
