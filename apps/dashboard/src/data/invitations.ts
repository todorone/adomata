import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminInvitationsResponseSchema, type AdminInvitation } from '@adomata/api/client'

import { authClient } from '@/lib/auth-client'
import { api } from './core/apiClient'
import { parseResponse } from './core/apiFetch'

export type Invitation = {
	id: string
	email: string
	role: string
	status: string
	organizationId: string
	inviterId: string
	expiresAt: Date | string
	createdAt: Date | string
}

export function useInvitations(enabled = true) {
	return useQuery({
		queryKey: ['invitations'],
		queryFn: async () => {
			const { data, error } = await authClient.organization.listInvitations()
			if (error) throw new Error(error.message ?? 'Failed to list invitations')
			return (data ?? []) as Invitation[]
		},
		enabled,
	})
}

export type InviteRole = 'member' | 'admin' | 'owner'

export function useInviteMember() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: async ({ email, role }: { email: string; role: InviteRole }) => {
			const { data, error } = await authClient.organization.inviteMember({ email, role })
			if (error) throw new Error(error.message ?? 'Failed to send invitation')
			return data
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
	})
}

export type { AdminInvitation }

export function useAdminInvitations(enabled = true) {
	return useQuery({
		queryKey: ['admin-invitations'],
		queryFn: async () => {
			const res = await api.admin.invitations.$get()
			const { invitations } = await parseResponse(res, adminInvitationsResponseSchema, 'GET /admin/invitations')
			return invitations
		},
		enabled,
	})
}

export function useCancelInvitation() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: async (invitationId: string) => {
			const { data, error } = await authClient.organization.cancelInvitation({ invitationId })
			if (error) throw new Error(error.message ?? 'Failed to cancel invitation')
			return data
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
	})
}
