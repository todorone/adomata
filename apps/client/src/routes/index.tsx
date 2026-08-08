import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireSession } from '@/data/session'
import { FleetBoard } from '@/pages/fleet-board/fleet-board'
import { fleetBoardSearchSchema, metricsSearchValue, type FleetBoardSearch } from '@/data/fleet-board-search'

function rangeKey(range: FleetBoardSearch['range']) {
	return typeof range === 'string' ? range : `${range.start}:${range.end}`
}

export const Route = createFileRoute('/')({
	beforeLoad: () => requireSession(),
	validateSearch: fleetBoardSearchSchema,
	component: Home,
})

function Home() {
	const search = Route.useSearch()
	const navigate = useNavigate({ from: Route.fullPath })
	return (
		<FleetBoard
			key={`${rangeKey(search.range)}:${search.search}:${search.needsAttention}:${search.clientId ?? ''}`}
			search={search}
			setSearch={changes =>
				navigate({
					search: previous => {
						const next = { ...search, ...changes }
						return {
							...previous,
							view: next.view,
							range: next.range,
							metrics: metricsSearchValue(next.metrics),
							group: next.group,
							depth: next.depth,
							search: next.search || undefined,
							needsAttention: next.needsAttention ? 'true' : undefined,
							hidePaused: next.hidePaused ? 'true' : undefined,
							clientId: next.clientId,
							sort: next.sort,
							direction: next.direction,
							account: next.account,
							ad: next.ad,
						}
					},
				})
			}
		/>
	)
}
