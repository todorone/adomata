import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminUsersResponseSchema, updateAdminUserResponseSchema, type UpdateAdminUserBody } from '@adomata/api/client'

import { api } from '../core/apiClient'
import { parseNoContent, parseResponse } from '../core/apiFetch'

export const userKeys = {
	all: ['admin', 'users'] as const,
	list: () => userKeys.all,
}

export const userQueries = {
	list: () =>
		queryOptions({
			queryKey: userKeys.list(),
			queryFn: async () =>
				parseResponse(await api.admin.users.$get(), adminUsersResponseSchema, 'GET /admin/users').then(
					r => r.users,
				),
		}),
}

export function useUsers() {
	return useQuery(userQueries.list())
}

export function useUpdateUser() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: async ({ id, ...body }: UpdateAdminUserBody & { id: string }) =>
			parseResponse(
				await api.admin.users[':id'].$patch({ param: { id }, json: body }),
				updateAdminUserResponseSchema,
				'PATCH /admin/users/:id',
			),
		onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
	})
}

export function useDeleteUser() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: async (id: string) =>
			parseNoContent(await api.admin.users[':id'].$delete({ param: { id } }), 'DELETE /admin/users/:id'),
		onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
	})
}
