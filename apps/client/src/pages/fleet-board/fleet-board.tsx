import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { fleetBoardKeys, fleetBoardParentKey, useFleetBoardRoot } from '@/data/fleet-board'
import type { FleetBoardSearch } from '@/data/fleet-board-search'
import { readForceRefresh, requestForceRefresh } from '@/data/force-refresh'
import {
	ControlRoom,
	EmptyState,
	ErrorState,
	FleetToolbar,
	LoadingState,
	SignalsView,
	TreeView,
} from './fleet-board.components'
import { expandSingleChildChain, type Node } from './fleet-board.logic'

export function FleetBoard({
	search,
	setSearch,
	columnLayoutKey = null,
	columnLayoutReady = true,
}: {
	search: FleetBoardSearch
	setSearch: (changes: Partial<FleetBoardSearch>) => void
	columnLayoutKey?: string | null
	columnLayoutReady?: boolean
}) {
	const root = useFleetBoardRoot({
		range: search.range,
		search: search.search,
		needsAttention: search.needsAttention,
		clientId: search.clientId,
		sort: search.sort,
		direction: search.direction,
	})
	const { refetch } = root
	const queryClient = useQueryClient()
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
	const [creativeAdId, setCreativeAdId] = useState<string | null>(search.ad ?? null)
	const [forceRefreshId, setForceRefreshId] = useState(() => sessionStorage.getItem('force-refresh-id'))

	function refresh() {
		requestForceRefresh()
			.then(requested => {
				sessionStorage.setItem('force-refresh-id', requested.id)
				setForceRefreshId(requested.id)
			})
			.catch(() => undefined)
	}

	useEffect(() => {
		if (!forceRefreshId) return
		let cancelled = false
		waitForForceRefresh(forceRefreshId)
			.then(async () => {
				if (cancelled) return
				const tasks: Promise<unknown>[] = [refetch()]
				if (creativeAdId)
					tasks.push(queryClient.invalidateQueries({ queryKey: fleetBoardKeys.creative(creativeAdId) }))
				await Promise.all(tasks)
			})
			.catch(() => undefined)
			.finally(() => {
				if (cancelled) return
				sessionStorage.removeItem('force-refresh-id')
				setForceRefreshId(null)
			})
		return () => {
			cancelled = true
		}
	}, [creativeAdId, forceRefreshId, queryClient, refetch])

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
			if (current.has(key)) {
				const next = new Set(current)
				next.delete(key)
				return next
			}
			return expandSingleChildChain(node, search, nodeIndex, current)
		})
	}

	const viewProps = {
		accounts: root.data?.accounts ?? [],
		search,
		setSearch,
		columnLayoutKey,
		nodeIndex,
		expanded,
		creativeAdId,
		onToggle: toggle,
	}
	const waitingForColumnLayoutIdentity = Boolean(root.data && !columnLayoutReady)
	const hasRows = Boolean(root.data && root.data.accounts.length > 0 && columnLayoutReady)

	return (
		<div className="mx-auto flex h-full w-full min-h-0 min-w-0 max-w-[1500px] flex-col gap-2">
			<FleetToolbar
				search={search}
				setSearch={setSearch}
				header={root.data?.header}
				clients={root.data?.clients ?? []}
				onRefresh={refresh}
				isRefreshing={forceRefreshId !== null}
			/>
			{(root.isPending && !root.data) || waitingForColumnLayoutIdentity ? <LoadingState /> : null}
			{root.isError ? <ErrorState retry={() => root.refetch().catch(() => undefined)} /> : null}
			{root.data && columnLayoutReady && root.data.accounts.length === 0 ? <EmptyState /> : null}
			{hasRows && search.view === 'tree' ? <TreeView {...viewProps} /> : null}
			{hasRows && search.view === 'control' ? <ControlRoom {...viewProps} /> : null}
			{hasRows && search.view === 'signals' ? <SignalsView {...viewProps} /> : null}
		</div>
	)
}

async function waitForForceRefresh(forceRefreshId: string) {
	let refresh = await readForceRefresh(forceRefreshId)
	while (refresh.status === 'queued' || refresh.status === 'running') {
		await new Promise(resolve => setTimeout(resolve, 1000))
		refresh = await readForceRefresh(forceRefreshId)
	}
	return refresh
}
