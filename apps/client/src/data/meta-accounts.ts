import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
	metaAccountsDiscoveryResponseSchema,
	resyncMetaAccountsResponseSchema,
	connectMetaAccountsResponseSchema,
	type ConnectMetaAccountsBody,
} from '@adomata/api/client'

import { api } from './core/apiClient'
import { parseResponse } from './core/apiFetch'
import { fleetBoardKeys } from './fleet-board'

export const metaAccountsKeys = {
	discovery: ['meta-accounts'] as const,
}

export const metaAccountsQueries = {
	discovery: (enabled = true) =>
		queryOptions({
			queryKey: metaAccountsKeys.discovery,
			queryFn: async () =>
				parseResponse(await api['meta-accounts'].$get(), metaAccountsDiscoveryResponseSchema, 'GET /meta-accounts'),
			enabled,
		}),
}

export function useMetaAccountsDiscovery(enabled: boolean) {
	return useQuery(metaAccountsQueries.discovery(enabled))
}

export function useConnectMetaAccounts() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: async (body: ConnectMetaAccountsBody) =>
			parseResponse(
				await api['meta-accounts'].connect.$post({ json: body }),
				connectMetaAccountsResponseSchema,
				'POST /meta-accounts/connect',
			),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: metaAccountsKeys.discovery })
			qc.invalidateQueries({ queryKey: fleetBoardKeys.all })
		},
	})
}

export function useResyncMetaAccounts() {
	return useMutation({
		mutationFn: async () =>
			parseResponse(
				await api['meta-accounts']['resync-insights'].$post(),
				resyncMetaAccountsResponseSchema,
				'POST /meta-accounts/resync-insights',
			),
	})
}
