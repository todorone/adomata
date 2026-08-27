import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@adomata/api/client'

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

const forceRefreshDeadlineMilliseconds = 5 * 60 * 1000
const forceRefreshCooldownMilliseconds = 60 * 1000

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
	const creativeAdIdRef = useRef(creativeAdId)
	const [forceRefreshId, setForceRefreshId] = useState(() => sessionStorage.getItem('force-refresh-id'))
	const [isRequestingForceRefresh, setIsRequestingForceRefresh] = useState(false)
	const [forceRefreshCooldownUntil, setForceRefreshCooldownUntil] = useState<number | null>(null)
	const [forceRefreshError, setForceRefreshError] = useState<string | null>(null)
	const forceRefreshDisabled =
		Boolean(forceRefreshId) || isRequestingForceRefresh || forceRefreshCooldownUntil !== null
	const forceRefreshPending = Boolean(forceRefreshId) || isRequestingForceRefresh

	function refresh() {
		if (forceRefreshDisabled) return
		setIsRequestingForceRefresh(true)
		requestForceRefresh()
			.then(requested => {
				sessionStorage.setItem('force-refresh-id', requested.id)
				setForceRefreshId(requested.id)
			})
			.catch(error => {
				if (error instanceof ApiClientError && error.status === 429) {
					setForceRefreshCooldownUntil(Date.now() + forceRefreshCooldownMilliseconds)
					return
				}
				setForceRefreshError('Не вдалося запустити оновлення даних.')
			})
			.finally(() => setIsRequestingForceRefresh(false))
	}

	useEffect(() => {
		if (forceRefreshCooldownUntil === null) return
		const timeout = window.setTimeout(
			() => setForceRefreshCooldownUntil(null),
			Math.max(0, forceRefreshCooldownUntil - Date.now()),
		)
		return () => window.clearTimeout(timeout)
	}, [forceRefreshCooldownUntil])

	const forceRefreshCooldownMessage = forceRefreshCooldownUntil ? 'Оновлення даних доступне раз на хвилину.' : null

	useEffect(() => {
		creativeAdIdRef.current = creativeAdId
	}, [creativeAdId])

	useEffect(() => {
		if (!forceRefreshId) return
		const controller = new AbortController()
		waitForForceRefresh(forceRefreshId, controller.signal)
			.then(async refresh => {
				if (controller.signal.aborted) return
				const tasks: Promise<unknown>[] = [refetch()]
				if (creativeAdIdRef.current)
					tasks.push(queryClient.invalidateQueries({ queryKey: fleetBoardKeys.creative(creativeAdIdRef.current) }))
				await Promise.all(tasks)
				if (refresh.status === 'completed') setForceRefreshError(null)
			})
			.catch(() => {
				if (!controller.signal.aborted) setForceRefreshError('Не вдалося завершити оновлення даних.')
			})
			.finally(() => {
				if (controller.signal.aborted) return
				sessionStorage.removeItem('force-refresh-id')
				setForceRefreshId(null)
			})
		return () => {
			controller.abort()
		}
	}, [forceRefreshId, queryClient, refetch])

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
		onRefresh: refresh,
		refreshDisabled: forceRefreshDisabled,
		refreshPending: forceRefreshPending,
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
				accounts={root.data?.accounts ?? []}
				onRefresh={refresh}
				refreshDisabled={forceRefreshDisabled}
				refreshPending={forceRefreshPending}
				forceRefreshCooldownMessage={forceRefreshCooldownMessage}
				forceRefreshError={forceRefreshError}
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

async function waitForForceRefresh(forceRefreshId: string, signal: AbortSignal) {
	const deadlineController = new AbortController()
	const abortForUnmount = () => deadlineController.abort(signal.reason)
	const deadline = window.setTimeout(() => deadlineController.abort(), forceRefreshDeadlineMilliseconds)
	signal.addEventListener('abort', abortForUnmount, { once: true })
	let attempt = 0
	try {
		while (true) {
			if (deadlineController.signal.aborted) throw deadlineController.signal.reason
			const refresh = await readForceRefresh(forceRefreshId, deadlineController.signal)
			if (deadlineController.signal.aborted) throw deadlineController.signal.reason
			if (refresh.status !== 'queued' && refresh.status !== 'running') return refresh
			await waitForForceRefreshPoll(Math.min(1000 * 2 ** attempt, 30_000), deadlineController.signal)
			attempt += 1
		}
	} catch (error) {
		if (deadlineController.signal.aborted && !signal.aborted)
			throw new Error('Force Refresh did not finish before the deadline')
		throw error
	} finally {
		window.clearTimeout(deadline)
		signal.removeEventListener('abort', abortForUnmount)
	}
}

function waitForForceRefreshPoll(milliseconds: number, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const timeout = window.setTimeout(resolve, milliseconds)
		signal.addEventListener(
			'abort',
			() => {
				window.clearTimeout(timeout)
				reject(signal.reason)
			},
			{ once: true },
		)
	})
}
