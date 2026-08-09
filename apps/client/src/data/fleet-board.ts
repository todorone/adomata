import { queryOptions, useQuery } from '@tanstack/react-query'
import {
	fleetBoardAdPreviewResponseSchema,
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
	sort: 'attention' | 'name' | 'owed' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpa' | 'results' | 'roas'
	direction: 'asc' | 'desc'
}

export const fleetBoardKeys = {
	all: ['fleet-board'] as const,
	root: (input: RootInput) => ['fleet-board', 'root', input] as const,
	children: (range: FleetBoardRange, parents: FleetBoardParent[]) =>
		['fleet-board', 'children', range, parents] as const,
	creative: (adId: string) => ['fleet-board', 'creative', adId] as const,
	adPreview: (adId: string) => ['fleet-board', 'ad-preview', adId] as const,
}

// A custom range has no preset name to send: it goes over the wire as range=custom plus its
// own from/to, mirroring the API's fleetBoardRangePresetSchema + from/to query shape.
function rangeQuery(range: FleetBoardRange) {
	return typeof range === 'string' ? { range } : { range: 'custom' as const, from: range.start, to: range.end }
}

export const fleetBoardQueries = {
	root: (input: RootInput) =>
		queryOptions({
			queryKey: fleetBoardKeys.root(input),
			queryFn: async () =>
				parseResponse(
					await api['fleet-board'].$get({
						query: {
							...rangeQuery(input.range),
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
					await api['fleet-board'].hierarchy.$get({
						query: { ...rangeQuery(range), parents: JSON.stringify(parents) },
					}),
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
	adPreview: (adId: string, enabled: boolean) =>
		queryOptions({
			queryKey: fleetBoardKeys.adPreview(adId),
			queryFn: async () =>
				parseResponse(
					await api['fleet-board'].ads[':adId'].preview.$get({ param: { adId } }),
					fleetBoardAdPreviewResponseSchema,
					'GET /fleet-board/ads/:adId/preview',
				),
			enabled: enabled && Boolean(adId),
			staleTime: 5 * 60 * 1000,
			gcTime: 5 * 60 * 1000,
		}),
}

export function useFleetBoardRoot(input: RootInput) {
	return useQuery(fleetBoardQueries.root(input))
}

export type FleetBoardRoot = FleetBoardRootResponse
