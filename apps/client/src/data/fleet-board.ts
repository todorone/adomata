import { queryOptions, useQuery } from '@tanstack/react-query'
import {
	fleetBoardCreativeResponseSchema,
	fleetBoardHierarchyResponseSchema,
	fleetBoardRootResponseSchema,
	type FleetBoardRange,
	type FleetBoardRootResponse,
} from '@adomata/api/client'

import { api } from './core/apiClient'
import { parseResponse } from './core/apiFetch'

export type FleetBoardParent = { type: 'account' | 'campaign' | 'adset'; id: string }
type RootInput = {
	range: FleetBoardRange
	search: string
	needsAttention: boolean
	clientId?: string
	sort: 'attention' | 'name' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpa' | 'roas'
	direction: 'asc' | 'desc'
}

export const fleetBoardKeys = {
	root: (input: RootInput) => ['fleet-board', 'root', input] as const,
	children: (range: FleetBoardRange, parents: FleetBoardParent[]) =>
		['fleet-board', 'children', range, parents] as const,
	creative: (adId: string) => ['fleet-board', 'creative', adId] as const,
}

export const fleetBoardQueries = {
	root: (input: RootInput) =>
		queryOptions({
			queryKey: fleetBoardKeys.root(input),
			queryFn: async () =>
				parseResponse(
					await api['fleet-board'].$get({
						query: {
							range: input.range,
							search: input.search || undefined,
							needsAttention: input.needsAttention ? 'true' : undefined,
							clientId: input.clientId,
							sort: input.sort,
							direction: input.direction,
						},
					}),
					fleetBoardRootResponseSchema,
					'GET /fleet-board',
				),
			placeholderData: previous => previous,
		}),
	children: (range: FleetBoardRange, parents: FleetBoardParent[]) =>
		queryOptions({
			queryKey: fleetBoardKeys.children(range, parents),
			queryFn: async () =>
				parseResponse(
					await api['fleet-board'].hierarchy.$get({ query: { range, parents: JSON.stringify(parents) } }),
					fleetBoardHierarchyResponseSchema,
					'GET /fleet-board/hierarchy',
				),
		}),
	creative: (adId: string) =>
		queryOptions({
			queryKey: fleetBoardKeys.creative(adId),
			queryFn: async () =>
				parseResponse(
					await api['fleet-board'].ads[':adId'].creative.$get({ param: { adId } }),
					fleetBoardCreativeResponseSchema,
					'GET /fleet-board/ads/:adId/creative',
				),
			enabled: Boolean(adId),
		}),
}

export function useFleetBoardRoot(input: RootInput) {
	return useQuery(fleetBoardQueries.root(input))
}

export type FleetBoardRoot = FleetBoardRootResponse
