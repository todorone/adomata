import { queryOptions, useQuery } from '@tanstack/react-query'
import {
	fleetBoardCreativeResponseSchema,
	fleetBoardRootResponseSchema,
	type FleetBoardRange,
	type FleetBoardRootResponse,
} from '@adomata/api/client'

import { api } from './core/apiClient'
import { parseResponse } from './core/apiFetch'

type RootInput = {
	range: FleetBoardRange
	search: string
	needsAttention: boolean
	clientId?: string
	sort: 'attention' | 'name' | 'owed' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpa' | 'results' | 'roas'
	direction: 'asc' | 'desc'
}

export type FleetBoardNode = FleetBoardRootResponse['nodes'][number]
export type FleetBoardNodeIndex = Record<string, FleetBoardNode[]>

export function fleetBoardParentKey(type: 'account' | 'campaign' | 'adset', id: string) {
	return `${type}:${id}`
}

export function indexFleetBoardNodes(nodes: FleetBoardNode[]): FleetBoardNodeIndex {
	const byParent = new Map<string, Map<string, FleetBoardNode>>()
	for (const node of nodes) {
		const parentType = node.type === 'campaign' ? 'account' : node.type === 'adset' ? 'campaign' : 'adset'
		const key = fleetBoardParentKey(parentType, node.parentId)
		const siblings = byParent.get(key) ?? new Map<string, FleetBoardNode>()
		siblings.set(node.id, node)
		byParent.set(key, siblings)
	}
	return Object.fromEntries([...byParent].map(([key, siblings]) => [key, [...siblings.values()]]))
}

function selectFleetBoardSnapshot(response: FleetBoardRootResponse) {
	return { ...response, nodeIndex: indexFleetBoardNodes(response.nodes) }
}

export const fleetBoardKeys = {
	all: ['fleet-board'] as const,
	root: (input: RootInput) => ['fleet-board', 'root', input] as const,
	creative: (adId: string) => ['fleet-board', 'creative', adId] as const,
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
			select: selectFleetBoardSnapshot,
			placeholderData: previous => previous,
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

export type FleetBoardRoot = ReturnType<typeof selectFleetBoardSnapshot>
