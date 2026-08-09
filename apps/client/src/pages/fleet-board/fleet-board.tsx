import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { fleetBoardKeys, fleetBoardParentKey, useFleetBoardRoot } from '@/data/fleet-board'
import type { FleetBoardSearch } from '@/data/fleet-board-search'
import {
	ControlRoom,
	EmptyState,
	ErrorState,
	FleetToolbar,
	LoadingState,
	SignalsView,
	TreeView,
} from './fleet-board.components'
import { type Node } from './fleet-board.logic'

export function FleetBoard({
	search,
	setSearch,
}: {
	search: FleetBoardSearch
	setSearch: (changes: Partial<FleetBoardSearch>) => void
}) {
	const root = useFleetBoardRoot({
		range: search.range,
		search: search.search,
		needsAttention: search.needsAttention,
		clientId: search.clientId,
		sort: search.sort,
		direction: search.direction,
	})
	const queryClient = useQueryClient()
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
	const [creativeAdId, setCreativeAdId] = useState<string | null>(search.ad ?? null)
	const [isRefreshing, setIsRefreshing] = useState(false)

	async function refresh() {
		setIsRefreshing(true)
		const tasks: Promise<unknown>[] = [root.refetch()]
		if (creativeAdId) tasks.push(queryClient.invalidateQueries({ queryKey: fleetBoardKeys.creative(creativeAdId) }))
		try {
			await Promise.all(tasks)
		} finally {
			setIsRefreshing(false)
		}
	}

	const nodeIndex = root.data?.nodeIndex ?? {}

	function toggle(node: Node) {
		if (node.type === 'ad') {
			const next = creativeAdId === node.id ? null : node.id
			setCreativeAdId(next)
			setSearch({ ad: next ?? undefined })
			return
		}
		const key = fleetBoardParentKey(node.type, node.id)
		setExpanded(current => {
			const next = new Set(current)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	}

	const viewProps = {
		accounts: root.data?.accounts ?? [],
		search,
		setSearch,
		nodeIndex,
		expanded,
		creativeAdId,
		onToggle: toggle,
	}
	const hasRows = Boolean(root.data && root.data.accounts.length > 0)

	return (
		<div className="mx-auto flex h-full w-full min-h-0 min-w-0 max-w-[1500px] flex-col gap-2">
			<FleetToolbar
				search={search}
				setSearch={setSearch}
				header={root.data?.header}
				clients={root.data?.clients ?? []}
				onRefresh={refresh}
				isRefreshing={isRefreshing}
			/>
			{root.isPending && !root.data ? <LoadingState /> : null}
			{root.isError ? <ErrorState retry={() => root.refetch().catch(() => undefined)} /> : null}
			{root.data && root.data.accounts.length === 0 ? <EmptyState /> : null}
			{hasRows && search.view === 'tree' ? <TreeView {...viewProps} /> : null}
			{hasRows && search.view === 'control' ? <ControlRoom {...viewProps} /> : null}
			{hasRows && search.view === 'signals' ? <SignalsView {...viewProps} /> : null}
		</div>
	)
}
