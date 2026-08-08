import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
	ArrowDown,
	ArrowUp,
	ChevronRight,
	Columns3,
	ExternalLink,
	Image as ImageIcon,
	ImageOff,
	RefreshCw,
	Search,
	SlidersHorizontal,
	Video,
	X,
} from 'lucide-react'
import type { FleetBoardHierarchyResponse } from '@adomata/api/client'

import { DateRangePicker } from '@/components/date-range-picker'
import {
	fleetBoardKeys,
	fleetBoardQueries,
	type FleetBoardParent,
	type FleetBoardRoot,
	useFleetBoardRoot,
} from '@/data/fleet-board'
import { fleetBoardMetricKeys, type FleetBoardMetricKey, type FleetBoardSearch } from '@/data/fleet-board-search'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip'

type Account = FleetBoardRoot['accounts'][number]
type Client = FleetBoardRoot['clients'][number]
type HierarchyNode = FleetBoardHierarchyResponse['nodes'][number]
type Node = Account | HierarchyNode
/**
 * A flattened board row. `currency` is inherited from the ancestor Ad Account: hierarchy nodes
 * carry no currency of their own, and every one of them descends from exactly one Ad Account
 * that has exactly one currency. `mergedClient` is set on the single row that stands in for a
 * Client with exactly one Ad Account.
 */
type TreeRow = { node: Node; level: number; currency: string | null; mergedClient?: Client }
type BoardRow = ({ kind: 'client'; client: Client } | ({ kind: 'node' } & TreeRow)) & { key: string }
type SortKey = FleetBoardSearch['sort']

const metricLabels: Record<FleetBoardMetricKey, string> = {
	spend: 'Витрати',
	impressions: 'Покази',
	clicks: 'Кліки',
	ctr: 'CTR',
	cpa: 'CPA',
	results: 'Результати',
	roas: 'ROAS',
}
const depthValues = ['account', 'campaign', 'adset', 'ad'] as const
const depthLabels = { account: 'Кабінети', campaign: 'Кампанії', adset: 'Групи оголошень', ad: 'Оголошення' } as const
const groupLabels = { client: 'За клієнтом', flat: 'Без групування' } as const
const viewLabels = { tree: 'Дерево', control: 'Пульт', signals: 'Сигнали' } as const
const laneLabels = {
	needs_attention: 'Потрібна увага',
	postpay: 'Післяплата',
	active: 'Активні',
	awaiting_data: 'Очікують даних',
} as const
const noData = '—'

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
	const [loadedNodes, setLoadedNodes] = useState<Record<string, HierarchyNode[]>>({})
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
	const [creativeAdId, setCreativeAdId] = useState<string | null>(search.ad ?? null)
	const [isRefreshing, setIsRefreshing] = useState(false)

	// Refetches everything currently on screen (root, every already-loaded hierarchy parent, and
	// an open creative panel) rather than just the root query, so the board never shows a mix of
	// freshly refetched Ad Account rows sitting above stale expanded children.
	async function refresh() {
		setIsRefreshing(true)
		const parents = Object.keys(loadedNodes).map(key => {
			const [type, id] = key.split(':') as [FleetBoardParent['type'], string]
			return { type, id }
		})
		const tasks: Promise<unknown>[] = [root.refetch()]
		if (parents.length > 0) {
			tasks.push(
				queryClient.fetchQuery(fleetBoardQueries.children(search.range, parents)).then(response => {
					setLoadedNodes(current => mergeChildren(current, parents, response.nodes))
				}),
			)
		}
		if (creativeAdId) tasks.push(queryClient.invalidateQueries({ queryKey: fleetBoardKeys.creative(creativeAdId) }))
		try {
			await Promise.all(tasks)
		} catch {
			// Root failures already surface via root.isError → ErrorState; a failed child/creative
			// refetch stays silent, matching loadChildren's existing (uncaught) behavior below.
		} finally {
			setIsRefreshing(false)
		}
	}

	useEffect(() => {
		if (!root.data || search.depth === 'account') return
		const parents = parentsNeededForDepth(root.data.accounts, loadedNodes, search.depth)
		if (parents.length === 0) return
		queryClient.fetchQuery(fleetBoardQueries.children(search.range, parents)).then(response => {
			setLoadedNodes(current => mergeChildren(current, parents, response.nodes))
		})
	}, [loadedNodes, queryClient, root.data, search.depth, search.range])

	function loadChildren(parents: FleetBoardParent[]) {
		const missing = parents.filter(parent => loadedNodes[parentKey(parent.type, parent.id)] === undefined)
		if (missing.length === 0) return
		queryClient.fetchQuery(fleetBoardQueries.children(search.range, missing)).then(response => {
			setLoadedNodes(current => mergeChildren(current, missing, response.nodes))
		})
	}

	function toggle(node: Node) {
		if (node.type === 'ad') {
			const next = creativeAdId === node.id ? null : node.id
			setCreativeAdId(next)
			setSearch({ ad: next ?? undefined })
			return
		}
		const key = parentKey(node.type, node.id)
		setExpanded(current => {
			const next = new Set(current)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
		loadChildren([{ type: node.type, id: node.id }])
	}

	const viewProps = {
		accounts: root.data?.accounts ?? [],
		clients: root.data?.clients ?? [],
		search,
		setSearch,
		loadedNodes,
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

function FleetToolbar({
	search,
	setSearch,
	header,
	clients,
	onRefresh,
	isRefreshing,
}: {
	search: FleetBoardSearch
	setSearch: (changes: Partial<FleetBoardSearch>) => void
	header?: FleetBoardRoot['header']
	clients: Client[]
	onRefresh: () => void
	isRefreshing: boolean
}) {
	const activeFilters =
		Number(search.search.length > 0) + Number(search.needsAttention) + Number(Boolean(search.clientId))
	// Sits outside the table's scroller rather than scrolling with the rows, so Time Range stays
	// reachable without scrolling back to the top.
	return (
		<section className="flex shrink-0 flex-col gap-2 border-b border-border pb-2">
			<div className="flex items-center gap-x-3 overflow-hidden">
				<h1 className="sr-only">Огляд рекламних кабінетів</h1>
				<div className="flex shrink-0 items-center gap-1" role="radiogroup" aria-label="Вигляд Fleet Board">
					{(Object.keys(viewLabels) as Array<keyof typeof viewLabels>).map(view => (
						<Button
							key={view}
							type="button"
							role="radio"
							size="xs"
							variant={search.view === view ? 'default' : 'ghost'}
							aria-checked={search.view === view}
							onClick={() => setSearch({ view })}
						>
							{viewLabels[view]}
						</Button>
					))}
				</div>
				{/* One line, never two: a wrapping freshness readout costs the board a row of fleet. */}
				<p className="ml-auto truncate text-xs text-muted-foreground" aria-live="polite">
					<span>
						Операційні:{' '}
						{freshnessText(
							header?.accountTierRefreshedAt,
							header?.accountTierStale ?? false,
							header?.accountTierNeverSynced ?? 0,
						)}
					</span>
					<span className="ml-3">
						Показники:{' '}
						{freshnessText(
							header?.insightsTierRefreshedAt,
							header?.insightsTierStale ?? false,
							header?.insightsTierNeverSynced ?? 0,
						)}
					</span>
					{header?.provisional ? (
						<span className="ml-3 font-medium text-amber-700 dark:text-amber-400">Уточнюється Meta.</span>
					) : null}
				</p>
				<TooltipProvider delayDuration={0}>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								aria-label="Оновити дані"
								disabled={isRefreshing}
								onClick={onRefresh}
							>
								<RefreshCw className={isRefreshing ? 'animate-spin' : undefined} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Оновити дані</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<DateRangePicker value={search.range} onChange={range => setSearch({ range })} />
				<CompactSelect
					label="Групування"
					value={search.group}
					labels={groupLabels}
					onChange={group => setSearch({ group })}
				/>
				<CompactSelect
					label="Глибина"
					value={search.depth}
					labels={depthLabels}
					onChange={depth => setSearch({ depth })}
				/>
				{/* A rendering toggle in the same family as collapse, not a filter: it hides rows
				    and never changes a parent's numbers, so it stays outside the Filters popover. */}
				<Button
					type="button"
					size="sm"
					variant={search.hidePaused ? 'default' : 'outline'}
					aria-pressed={search.hidePaused}
					onClick={() => setSearch({ hidePaused: !search.hidePaused })}
				>
					Лише активні рядки
				</Button>
				<Popover>
					<PopoverTrigger asChild>
						<Button type="button" size="sm" variant="outline">
							<SlidersHorizontal />
							Фільтри
							{/* The badge always occupies its slot: appearing from nothing would widen the
							    trigger and shove the controls beside it sideways. */}
							<span
								className={`w-4 rounded-full text-xs ${activeFilters > 0 ? 'bg-primary text-primary-foreground' : 'invisible'}`}
								aria-label={activeFilters > 0 ? `активних фільтрів: ${activeFilters}` : undefined}
							>
								{activeFilters > 0 ? activeFilters : null}
							</span>
						</Button>
					</PopoverTrigger>
					<PopoverContent className="flex flex-col gap-3">
						<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
							Пошук
							<span className="flex items-center gap-2 rounded-md border bg-background px-2">
								<Search size={14} />
								<input
									value={search.search}
									onChange={event => setSearch({ search: event.target.value })}
									placeholder="Клієнт або кабінет"
									className="h-8 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
								/>
							</span>
						</label>
						<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
							Клієнт
							<select
								value={search.clientId ?? ''}
								onChange={event => setSearch({ clientId: event.target.value || undefined })}
								className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
							>
								<option value="">Усі клієнти</option>
								{clients.map(client => (
									<option key={client.id} value={client.id}>
										{client.name}
									</option>
								))}
							</select>
						</label>
						<label className="flex items-center gap-2 text-sm text-foreground">
							<input
								checked={search.needsAttention}
								onChange={event => setSearch({ needsAttention: event.target.checked })}
								type="checkbox"
							/>
							Потрібна увага
						</label>
					</PopoverContent>
				</Popover>
				<Popover>
					<PopoverTrigger asChild>
						<Button type="button" size="sm" variant="outline">
							<Columns3 />
							Показники
							<span className="text-xs text-muted-foreground">{search.metrics.length}</span>
						</Button>
					</PopoverTrigger>
					<PopoverContent className="flex flex-col gap-1" aria-label="Вибір показників">
						{fleetBoardMetricKeys.map(metric => {
							const active = search.metrics.includes(metric)
							return (
								<Button
									key={metric}
									type="button"
									size="sm"
									variant={active ? 'secondary' : 'ghost'}
									className="justify-start"
									aria-pressed={active}
									onClick={() => setSearch({ metrics: nextMetrics(search, metric) })}
								>
									{metricLabels[metric]}
								</Button>
							)
						})}
					</PopoverContent>
				</Popover>
			</div>
		</section>
	)
}

function CompactSelect<Value extends string>({
	label,
	value,
	labels,
	onChange,
}: {
	label: string
	value: Value
	labels: Record<Value, string>
	onChange: (value: Value) => void
}) {
	return (
		<Select value={value} onValueChange={next => onChange(next as Value)} items={labels}>
			<SelectTrigger size="sm" aria-label={label}>
				<span className="text-muted-foreground">{label}:</span>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{(Object.keys(labels) as Value[]).map(option => (
					<SelectItem key={option} value={option}>
						{labels[option]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

type ViewProps = {
	accounts: Account[]
	clients: Client[]
	search: FleetBoardSearch
	setSearch: (changes: Partial<FleetBoardSearch>) => void
	loadedNodes: Record<string, HierarchyNode[]>
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
}

function TreeView({ accounts, clients, search, setSearch, loadedNodes, expanded, creativeAdId, onToggle }: ViewProps) {
	const rows = flattenRows(accounts, clients, search, loadedNodes, expanded)
	const scrollRef = useRef<HTMLDivElement>(null)
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 36,
		overscan: 12,
	})
	return (
		// No fixed height: the table fills whatever the viewport leaves after the toolbar, so it
		// is the page's only vertical scroller rather than one nested inside a scrolling page.
		<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
			<div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
				{/* treegrid wraps the header row and the row group directly, so the grid relationship
				    survives the wrappers the horizontal scroller and the virtualizer need. */}
				<div
					className="flex min-h-0 flex-1 flex-col"
					role="treegrid"
					aria-label="Дерево рекламних кабінетів"
					style={{ minWidth: gridMinWidth(search.metrics) }}
				>
					<ColumnHeader search={search} setSearch={setSearch} />
					<div ref={scrollRef} role="rowgroup" className="min-h-0 flex-1 overflow-y-auto">
						<div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} role="presentation">
							{virtualizer.getVirtualItems().map(item => {
								const row = rows[item.index]!
								return (
									<div
										key={row.key}
										ref={virtualizer.measureElement}
										data-index={item.index}
										role="presentation"
										style={{
											position: 'absolute',
											top: 0,
											left: 0,
											width: '100%',
											transform: `translateY(${item.start}px)`,
										}}
									>
										{row.kind === 'client' ? (
											<ClientRow client={row.client} metrics={search.metrics} />
										) : (
											<NodeRow
												row={row}
												metrics={search.metrics}
												expanded={expanded}
												creativeAdId={creativeAdId}
												onToggle={onToggle}
											/>
										)}
									</div>
								)
							})}
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}

function ColumnHeader({
	search,
	setSearch,
}: {
	search: FleetBoardSearch
	setSearch: (changes: Partial<FleetBoardSearch>) => void
}) {
	function sortBy(sort: SortKey) {
		setSearch(
			search.sort === sort
				? { direction: search.direction === 'asc' ? 'desc' : 'asc' }
				: { sort, direction: 'desc' },
		)
	}
	const cell = (sort: SortKey | null, label: string, alignRight = false) => (
		<span
			key={label}
			role="columnheader"
			aria-sort={
				sort === null || search.sort !== sort ? 'none' : search.direction === 'asc' ? 'ascending' : 'descending'
			}
			className={alignRight ? 'text-right' : undefined}
		>
			{sort === null ? (
				label
			) : (
				<button
					type="button"
					onClick={() => sortBy(sort)}
					aria-label={`Сортувати за: ${label}`}
					className="inline-flex items-center gap-1 hover:text-foreground"
				>
					{label}
					{search.sort !== sort ? null : search.direction === 'asc' ? (
						<ArrowUp size={12} />
					) : (
						<ArrowDown size={12} />
					)}
				</button>
			)}
		</span>
	)
	return (
		<div
			role="row"
			className="grid shrink-0 items-center gap-2 border-b bg-muted/40 px-2 py-1 text-xs font-semibold text-muted-foreground"
			style={{ gridTemplateColumns: gridTemplate(search.metrics) }}
		>
			{cell('name', 'Структура')}
			{cell('attention', 'Здоров’я')}
			{cell(null, 'Стан')}
			{cell('owed', 'Заборгованість', true)}
			{search.metrics.map(metric => cell(metric, metricLabels[metric], true))}
		</div>
	)
}

function ControlRoom({
	accounts,
	clients,
	search,
	setSearch,
	loadedNodes,
	expanded,
	creativeAdId,
	onToggle,
}: ViewProps) {
	const selected = accounts.find(account => account.id === search.account) ?? accounts[0]!
	const railItems: Array<{ client: Client } | { account: Account }> =
		search.group === 'client'
			? clients.flatMap(client => [
					{ client },
					...accounts.filter(account => account.clientId === client.id).map(account => ({ account })),
				])
			: accounts.map(account => ({ account }))
	const railRef = useRef<HTMLDivElement>(null)
	const rail = useVirtualizer({
		count: railItems.length,
		getScrollElement: () => railRef.current,
		// Rail rows now carry name, Health and the selected KPIs, so their height varies with the
		// metric selection and is measured rather than assumed.
		estimateSize: () => 72,
		overscan: 8,
	})
	return (
		<section className="grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:grid-cols-[minmax(240px,0.3fr)_minmax(0,1fr)]">
			<aside
				className="flex min-h-0 flex-col border-b bg-muted/35 p-2 lg:border-r lg:border-b-0"
				aria-label="Список рекламних кабінетів"
			>
				<div ref={railRef} className="max-h-64 min-h-0 overflow-auto lg:max-h-none lg:flex-1">
					<div style={{ height: rail.getTotalSize(), position: 'relative' }}>
						{rail.getVirtualItems().map(item => {
							const itemValue = railItems[item.index]!
							if ('client' in itemValue) {
								return (
									<p
										key={`client:${itemValue.client.id}`}
										ref={rail.measureElement}
										data-index={item.index}
										className="absolute w-full truncate px-2 py-2 text-xs font-semibold text-muted-foreground"
										style={{ transform: `translateY(${item.start}px)` }}
									>
										{itemValue.client.name}
									</p>
								)
							}
							const { account } = itemValue
							const isSelected = account.id === selected.id
							return (
								<button
									key={account.id}
									type="button"
									ref={rail.measureElement}
									data-index={item.index}
									aria-current={isSelected ? 'true' : undefined}
									onClick={() => setSearch({ account: account.id })}
									className={`absolute flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm ${
										isSelected
											? 'border-l-2 border-primary bg-background font-medium shadow-sm'
											: 'border-l-2 border-transparent hover:bg-background/60'
									}`}
									style={{ transform: `translateY(${item.start}px)` }}
								>
									{/* The name leads and must not be the element that truncates away. */}
									<span className="w-full truncate">{account.name}</span>
									<HealthLabel health={account.health} />
									<span className="flex w-full flex-wrap gap-x-2 text-xs text-muted-foreground">
										{search.metrics.map(metric => (
											<span key={metric}>
												{metricLabels[metric]}:{' '}
												<strong className="font-medium text-foreground">
													{formatKpi(metric, account.kpis[metric], account.currency)}
												</strong>
											</span>
										))}
									</span>
								</button>
							)
						})}
					</div>
				</div>
			</aside>
			<div className="flex min-h-0 min-w-0 flex-col p-3">
				{/* The Ad Account name and its Meta link belong to the row below, which carries them
				    in aligned cells; repeating them here is what made the pane say the name thrice. */}
				<p className="mb-2 shrink-0 text-xs text-muted-foreground">{selected.clientName}</p>
				<TreeView
					accounts={[selected]}
					clients={clients.filter(client => client.id === selected.clientId)}
					search={{ ...search, group: 'flat' }}
					setSearch={setSearch}
					loadedNodes={loadedNodes}
					expanded={expanded}
					creativeAdId={creativeAdId}
					onToggle={onToggle}
				/>
			</div>
		</section>
	)
}

function SignalsView({ accounts, clients, search, loadedNodes, expanded, creativeAdId, onToggle }: ViewProps) {
	const [openedClients, setOpenedClients] = useState<Set<string>>(new Set())
	const items = search.group === 'client' ? clients : accounts
	return (
		// content-start so the lanes pack against the top: a stretched grid row would give an
		// empty lane the height the spec just took away from it.
		<div className="grid min-h-0 min-w-0 flex-1 content-start items-start gap-3 overflow-y-auto xl:grid-cols-2">
			{(Object.keys(laneLabels) as Array<keyof typeof laneLabels>).map(lane => (
				<SignalLane
					key={lane}
					lane={lane}
					items={items.filter(item => item.signalsLane === lane)}
					accounts={accounts}
					search={search}
					loadedNodes={loadedNodes}
					expanded={expanded}
					creativeAdId={creativeAdId}
					onToggle={onToggle}
					openedClients={openedClients}
					setOpenedClients={setOpenedClients}
				/>
			))}
		</div>
	)
}

function SignalLane({
	lane,
	items,
	accounts,
	search,
	loadedNodes,
	expanded,
	creativeAdId,
	onToggle,
	openedClients,
	setOpenedClients,
}: {
	lane: keyof typeof laneLabels
	items: Array<Client | Account>
	accounts: Account[]
	search: FleetBoardSearch
	loadedNodes: Record<string, HierarchyNode[]>
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
	openedClients: Set<string>
	setOpenedClients: (next: Set<string>) => void
}) {
	// Lanes size to their contents: an empty lane is a thin labelled header with its count,
	// never a fixed-height empty box holding a quarter of the screen.
	return (
		<section className="rounded-xl border border-border bg-card p-2 shadow-sm" aria-labelledby={`lane-${lane}`}>
			<header className="flex items-center justify-between px-1">
				<h2 id={`lane-${lane}`} className="text-sm font-semibold">
					{laneLabels[lane]}
				</h2>
				<span className="rounded-full bg-muted px-2 py-0.5 text-xs">{items.length}</span>
			</header>
			{items.length === 0 ? null : (
				<div className="mt-2 flex flex-col gap-2">
					{items.map(value => {
						const isClient = !('type' in value)
						const isOpen = isClient ? openedClients.has(value.id) : expanded.has(parentKey('account', value.id))
						const childAccounts = isClient ? accounts.filter(account => account.clientId === value.id) : [value]
						const sync = syncNote(childAccounts)
						return (
							<article key={value.id} className="rounded-lg border bg-background p-2">
								<button
									type="button"
									className="flex w-full items-start justify-between gap-3 text-left"
									onClick={() => {
										if (isClient) {
											const next = new Set(openedClients)
											if (next.has(value.id)) next.delete(value.id)
											else next.add(value.id)
											setOpenedClients(next)
										} else onToggle(value)
									}}
								>
									<span className="min-w-0">
										<span className="block truncate text-sm font-medium">{value.name}</span>
										{isClient ? null : (
											<span className="block truncate text-xs text-muted-foreground">
												{value.clientName}
											</span>
										)}
									</span>
									<HealthLabel
										health={value.health}
										// Where the reason merely restates the lane title it is de-emphasised,
										// never removed: ADR 0018 keeps Color and Reason together.
										muted={value.signalsLane === lane}
									/>
								</button>
								<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
									<span>
										Заборгованість:{' '}
										<strong className="font-medium text-foreground">
											{formatMoney(value.amountOwed, value.currency)}
										</strong>
									</span>
									{/* A failed or missing sync is Adomata's reach, not Meta's verdict on the
									    account — it gets its own wording so it is not escalated as ill health. */}
									{sync ? (
										<span className="rounded-full bg-muted px-2 py-0.5 text-foreground">{sync}</span>
									) : null}
									{isClient ? null : <MetaAdsManagerLink accountId={value.id} />}
								</div>
								<KpiStrip kpis={value.kpis} metrics={search.metrics} currency={value.currency} />
								{isOpen ? (
									<div className="mt-2 border-t pt-1">
										{childAccounts
											.flatMap(account => flattenAccount(account, 0, search, loadedNodes, expanded))
											.map(row => (
												<NodeRow
													key={`${row.node.type}:${row.node.id}`}
													row={row}
													metrics={search.metrics}
													expanded={expanded}
													creativeAdId={creativeAdId}
													onToggle={onToggle}
												/>
											))}
									</div>
								) : null}
							</article>
						)
					})}
				</div>
			)}
		</section>
	)
}

function ClientRow({ client, metrics }: { client: Client; metrics: FleetBoardMetricKey[] }) {
	return (
		<div
			role="row"
			className="grid min-h-9 items-center gap-2 border-b bg-muted/35 px-2 text-sm font-semibold"
			style={{ gridTemplateColumns: gridTemplate(metrics) }}
		>
			<span className="truncate">
				{client.name}
				{client.mixedTimezone ? (
					<small className="ml-2 font-normal text-muted-foreground">кілька часових поясів</small>
				) : null}
			</span>
			<HealthLabel health={client.health} />
			<RunningCell running={client.kpis.running} />
			<span className="text-right tabular-nums">{formatMoney(client.amountOwed, client.currency)}</span>
			{metrics.map(metric => (
				<KpiCell key={metric} metric={metric} kpis={client.kpis} currency={client.currency} />
			))}
		</div>
	)
}

function NodeRow({
	row,
	metrics,
	expanded,
	creativeAdId,
	onToggle,
}: {
	row: TreeRow
	metrics: FleetBoardMetricKey[]
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
}) {
	const { node } = row
	const isAccount = node.type === 'account'
	const isExpandable = node.type !== 'ad'
	const isExpanded = node.type === 'ad' ? creativeAdId === node.id : expanded.has(parentKey(node.type, node.id))
	return (
		<div className="border-b px-2" role="presentation">
			<div
				role="row"
				aria-level={row.level + 1}
				aria-expanded={isExpandable ? isExpanded : undefined}
				tabIndex={0}
				className="grid min-h-9 cursor-pointer items-center gap-2 text-sm"
				onClick={() => onToggle(node)}
				onKeyDown={event => {
					if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
					event.preventDefault()
					onToggle(node)
				}}
				style={{ gridTemplateColumns: gridTemplate(metrics) }}
			>
				<span className="flex min-w-0 items-center gap-1" style={{ paddingInlineStart: row.level * 14 }}>
					<button
						type="button"
						onClick={event => {
							event.stopPropagation()
							onToggle(node)
						}}
						className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left"
						aria-label={
							node.type === 'ad'
								? `Відкрити креатив ${node.name}`
								: `${isExpanded ? 'Згорнути' : 'Розгорнути'} ${node.name}`
						}
					>
						{node.type !== 'ad' ? (
							<ChevronRight
								size={14}
								className={
									isExpanded ? 'shrink-0 rotate-90 transition-transform' : 'shrink-0 transition-transform'
								}
							/>
						) : (
							<AdThumbnail creativeId={node.creativeId} />
						)}
						{row.mergedClient ? (
							<span className="min-w-0 truncate">
								{row.mergedClient.name}
								<small className="ml-2 font-normal text-muted-foreground">{node.name}</small>
							</span>
						) : (
							<span className="truncate">{node.name}</span>
						)}
					</button>
					{isAccount ? <MetaAdsManagerLink accountId={node.id} /> : null}
				</span>
				{'health' in node ? <HealthLabel health={node.health} /> : <span />}
				{'connectionStatus' in node ? (
					<RunningCell running={node.kpis.running} />
				) : (
					<span className="truncate text-xs text-muted-foreground">
						{effectiveStatusText(node.effectiveStatus)}
					</span>
				)}
				{/* Amount owed is an Ad Account property, not a rollup: interior rows leave it empty. */}
				<span className="text-right tabular-nums">
					{node.type === 'account' ? formatMoney(node.amountOwed, row.currency) : null}
				</span>
				{metrics.map(metric => (
					<KpiCell key={metric} metric={metric} kpis={node.kpis} currency={row.currency} />
				))}
			</div>
			{node.type === 'ad' && creativeAdId === node.id ? (
				<CreativeDetail adId={node.id} onClose={() => onToggle(node)} />
			) : null}
		</div>
	)
}

function AdThumbnail({ creativeId }: { creativeId: string | null }) {
	const [failed, setFailed] = useState(false)
	if (!creativeId || failed) {
		return <ImageIcon size={14} className="mr-2 shrink-0 text-muted-foreground" aria-hidden />
	}
	return (
		<img
			src={mediaUrl(creativeId, 'thumb')}
			alt=""
			// Sized to the row's own min-h-9 (36px) minus 2px top/bottom, so it reads as "fills the
			// row" without depending on the row's actual height at render time.
			className="my-0.5 mr-2 h-8 w-8 shrink-0 rounded object-cover"
			onError={() => setFailed(true)}
		/>
	)
}

function CreativeDetail({ adId, onClose }: { adId: string; onClose: () => void }) {
	const [selectedAssetKey, setSelectedAssetKey] = useState<string | null>(null)
	const creative = useQuery(fleetBoardQueries.creative(adId))
	if (creative.isPending)
		return (
			<p className="py-2 text-sm text-muted-foreground" aria-live="polite">
				Завантажуємо креатив…
			</p>
		)
	if (creative.isError || !creative.data)
		return (
			<p className="py-2 text-sm text-muted-foreground">
				Не вдалося завантажити креатив. Показники оголошення доступні.
			</p>
		)
	const data = creative.data
	const mediaAssets = data.assets.filter(
		(asset): asset is typeof asset & { mediaKey: string } => asset.mediaKey !== null,
	)
	const selectedAsset = mediaAssets.find(asset => asset.key === selectedAssetKey) ?? mediaAssets[0]
	return (
		<div className="my-2 rounded-lg border bg-muted/20 p-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="line-clamp-1 font-medium">{creativeTitle(data)}</p>
					{data.body ? <p className="line-clamp-3 text-sm text-muted-foreground">{data.body}</p> : null}
					{data.description ? <p className="mt-1 text-xs text-muted-foreground">{data.description}</p> : null}
					{data.callToAction ? (
						<p className="mt-1 text-xs text-muted-foreground">Дія: {callToActionText(data.callToAction)}</p>
					) : null}
					{data.destination ? (
						<a
							className="mt-1 block text-xs text-primary underline"
							href={data.destination}
							target="_blank"
							rel="noreferrer noopener"
						>
							Перейти за посиланням
						</a>
					) : null}
				</div>
				<div className="flex items-center gap-2">
					{/* Only a Creative that really carries several assets needs the note, otherwise
					    it stops meaning anything where it appears. */}
					{data.assets.length > 1 ? (
						<span className="rounded-full bg-muted px-2 py-1 text-xs">Результати належать оголошенню цілком</span>
					) : null}
					<Button type="button" size="icon-sm" variant="ghost" onClick={onClose} aria-label="Закрити креатив">
						<X />
					</Button>
				</div>
			</div>
			{selectedAsset?.mediaKey ? (
				<div className="mt-3 overflow-hidden rounded-md border bg-background">
					{selectedAsset.kind === 'video' ? (
						<video
							key={selectedAsset.key}
							aria-label={selectedAsset.label}
							className="max-h-[36rem] w-full bg-black object-contain"
							controls
							preload="metadata"
							src={mediaUrl(data.id, selectedAsset.mediaKey)}
						/>
					) : (
						<img
							src={mediaUrl(data.id, selectedAsset.mediaKey)}
							alt={selectedAsset.label}
							className="max-h-[36rem] w-full object-contain"
						/>
					)}
				</div>
			) : null}
			{mediaAssets.length > 1 ? (
				<div className="mt-3 flex flex-wrap gap-2">
					{mediaAssets.map(asset => (
						<button
							key={asset.key}
							type="button"
							className="w-28 overflow-hidden rounded-md border bg-background text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
							onClick={() => setSelectedAssetKey(asset.key)}
							aria-pressed={selectedAsset?.key === asset.key}
						>
							{asset.kind === 'video' ? (
								<div className="flex aspect-square items-center justify-center bg-muted text-muted-foreground">
									<Video size={24} aria-hidden="true" />
								</div>
							) : (
								<img
									src={mediaUrl(data.id, asset.mediaKey)}
									alt=""
									className="aspect-square w-full object-cover"
								/>
							)}
							<p className="truncate px-2 py-1 text-xs">{asset.label}</p>
						</button>
					))}
				</div>
			) : null}
			{data.assets.some(asset => !asset.mediaKey) || data.mediaUnavailable ? (
				<div className="mt-3 flex flex-wrap gap-2">
					{data.assets
						.filter(asset => !asset.mediaKey)
						.map(asset => (
							<div key={asset.key} className="w-28 overflow-hidden rounded-md border bg-background">
								<div className="flex aspect-square items-center justify-center bg-muted p-2 text-center text-xs text-muted-foreground">
									{asset.kind === 'image' || asset.kind === 'video'
										? 'Медіафайл'
										: (asset.value ?? asset.label)}
								</div>
								<p className="truncate px-2 py-1 text-xs">
									{asset.label}
									{asset.value ? `: ${asset.value}` : ''}
								</p>
							</div>
						))}
					{data.mediaUnavailable ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<ImageOff size={16} />
							Медіа тимчасово недоступне
						</div>
					) : null}
				</div>
			) : null}
			{/* Plumbing, not the Creative: demoted out of the primary reading order. */}
			{data.existingPostId ? (
				<p className="mt-2 text-xs text-muted-foreground/70">Ідентифікатор допису Meta: {data.existingPostId}</p>
			) : null}
		</div>
	)
}

function MetaAdsManagerLink({ accountId }: { accountId: string }) {
	return (
		<a
			href={metaAdsManagerUrl(accountId)}
			target="_blank"
			rel="noreferrer noopener"
			aria-label="Відкрити у Meta Ads Manager"
			className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-primary"
			onClick={event => event.stopPropagation()}
		>
			<ExternalLink size={14} />
		</a>
	)
}

function HealthDot({ color }: { color: string }) {
	return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${healthColorClass(color)}`} aria-hidden />
}

function HealthLabel({
	health,
	muted = false,
}: {
	health: { color: string; reason: { code: string }; needsAttention: boolean }
	muted?: boolean
}) {
	return (
		<span
			className={`inline-flex min-w-0 items-center gap-1.5 text-xs ${muted ? 'text-muted-foreground/70' : ''}`}
			title={healthText(health.reason.code)}
			aria-label={`${healthText(health.reason.code)}${health.needsAttention ? ', потрібна увага' : ''}`}
		>
			<HealthDot color={health.color} />
			<span className="truncate">{healthText(health.reason.code)}</span>
		</span>
	)
}

function RunningCell({ running }: { running: boolean }) {
	return <span className="truncate text-xs text-muted-foreground">{running ? 'Є активні' : 'Неактивні'}</span>
}

function KpiStrip({
	kpis,
	metrics,
	currency,
}: {
	kpis: Node['kpis'] | Client['kpis']
	metrics: FleetBoardMetricKey[]
	currency: string | null
}) {
	return (
		<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
			{metrics.map(metric => (
				<span key={metric}>
					{metricLabels[metric]}:{' '}
					<strong className="text-foreground">{formatKpi(metric, kpis[metric], currency)}</strong>
				</span>
			))}
		</div>
	)
}

function KpiCell({
	metric,
	kpis,
	currency,
}: {
	metric: FleetBoardMetricKey
	kpis: Node['kpis'] | Client['kpis']
	currency: string | null
}) {
	return <span className="text-right tabular-nums">{formatKpi(metric, kpis[metric], currency)}</span>
}

function flattenRows(
	accounts: Account[],
	clients: Client[],
	search: FleetBoardSearch,
	children: Record<string, HierarchyNode[]>,
	expanded: Set<string>,
): BoardRow[] {
	const nodeRows = (rows: TreeRow[]) => rows.map(row => ({ kind: 'node' as const, ...row, key: rowKey(row) }))
	if (search.group === 'flat')
		return accounts.flatMap(account => nodeRows(flattenAccount(account, 0, search, children, expanded)))
	return clients.flatMap(client => {
		const clientAccounts = accounts.filter(account => account.clientId === client.id)
		if (clientAccounts.length === 1) {
			const rows = flattenAccount(clientAccounts[0]!, 0, search, children, expanded)
			return nodeRows(rows.map((row, index) => (index === 0 ? { ...row, mergedClient: client } : row)))
		}
		return [
			{ kind: 'client' as const, client, key: `client:${client.id}` },
			...clientAccounts.flatMap(account => nodeRows(flattenAccount(account, 1, search, children, expanded))),
		]
	})
}

function flattenAccount(
	account: Account,
	baseLevel: number,
	search: FleetBoardSearch,
	children: Record<string, HierarchyNode[]>,
	expanded: Set<string>,
) {
	return flattenNode(account, baseLevel, account.currency, search, children, expanded)
}

function flattenNode(
	node: Node,
	level: number,
	currency: string | null,
	search: FleetBoardSearch,
	children: Record<string, HierarchyNode[]>,
	expanded: Set<string>,
): TreeRow[] {
	const rows: TreeRow[] = [{ node, level, currency }]
	if (node.type === 'ad') return rows
	const typeDepth = depthValues.indexOf(node.type)
	if (depthValues.indexOf(search.depth) <= typeDepth && !expanded.has(parentKey(node.type, node.id))) return rows
	for (const child of children[parentKey(node.type, node.id)] ?? []) {
		// A rendering toggle, not a filter: hiding a non-Running interior row changes nothing
		// about any parent's numbers, which are rollups computed server-side.
		if (search.hidePaused && !child.kpis.running) continue
		rows.push(...flattenNode(child, level + 1, currency, search, children, expanded))
	}
	return rows
}

function parentsNeededForDepth(
	accounts: Account[],
	children: Record<string, HierarchyNode[]>,
	depth: FleetBoardSearch['depth'],
) {
	const target = depthValues.indexOf(depth)
	let parents: FleetBoardParent[] = accounts.map(account => ({ type: 'account', id: account.id }))
	for (let level = 0; level < target; level += 1) {
		const missing = parents.filter(parent => children[parentKey(parent.type, parent.id)] === undefined)
		if (missing.length > 0) return missing.slice(0, 50)
		parents = parents.flatMap(parent =>
			(children[parentKey(parent.type, parent.id)] ?? [])
				.filter(node => node.type !== 'ad')
				.map(node => ({ type: node.type, id: node.id }) as FleetBoardParent),
		)
	}
	return []
}

function mergeChildren(
	current: Record<string, HierarchyNode[]>,
	requested: FleetBoardParent[],
	nodes: HierarchyNode[],
) {
	const next = { ...current }
	// Record every requested parent, including the ones that turned out to have no children:
	// leaving their key undefined reads as "not loaded yet" and makes the depth loader refetch
	// them forever.
	for (const parent of requested) next[parentKey(parent.type, parent.id)] ??= []
	for (const node of nodes)
		next[parentKey(parentTypeForChild(node.type), node.parentId)] = [
			...(next[parentKey(parentTypeForChild(node.type), node.parentId)] ?? []),
			node,
		]
	return Object.fromEntries(Object.entries(next).map(([key, value]) => [key, uniqueNodes(value)]))
}

function uniqueNodes(nodes: HierarchyNode[]) {
	return [...new Map(nodes.map(node => [node.id, node])).values()]
}
function parentTypeForChild(type: HierarchyNode['type']): FleetBoardParent['type'] {
	return type === 'campaign' ? 'account' : type === 'adset' ? 'campaign' : 'adset'
}
function parentKey(type: FleetBoardParent['type'] | 'account', id: string) {
	return `${type}:${id}`
}
function rowKey(row: TreeRow) {
	return `${row.node.type}:${row.node.id}:${row.level}`
}
// One source of truth for the row grid: the template and the min width are derived from the
// same floors, so widening a column cannot silently desync the width the table scrolls at.
// The name column is capped so surplus width goes to the KPI columns rather than a dead gap.
const columnWidths = { name: [180, 340], health: [132, 190], running: [84, 110], owed: [96, 130] } as const
const metricColumnMin = 88
const columnGap = 8
const rowPaddingX = 8

function gridTemplate(metrics: FleetBoardMetricKey[]) {
	const fixed = Object.values(columnWidths)
		.map(([min, max]) => `minmax(${min}px, ${max}px)`)
		.join(' ')
	return `${fixed} repeat(${metrics.length}, minmax(${metricColumnMin}px, 1fr))`
}
function gridMinWidth(metrics: FleetBoardMetricKey[]) {
	const columns = Object.values(columnWidths).length + metrics.length
	const floors = Object.values(columnWidths).reduce((total, [min]) => total + min, metrics.length * metricColumnMin)
	return floors + (columns - 1) * columnGap + rowPaddingX * 2
}
function nextMetrics(search: FleetBoardSearch, metric: FleetBoardMetricKey) {
	const metrics = search.metrics.includes(metric)
		? search.metrics.filter(value => value !== metric)
		: [...search.metrics, metric]
	return metrics.length ? metrics : search.metrics
}
function healthColorClass(color: string) {
	return color === 'red'
		? 'bg-red-500'
		: color === 'yellow'
			? 'bg-amber-500'
			: color === 'green'
				? 'bg-emerald-500'
				: 'bg-slate-400'
}
function healthText(code: string) {
	return (
		(
			{
				// Kept short enough to survive the Health column without truncating: the Reason has
				// to stay readable beside its Color, not be cut to an ellipsis (ADR 0018).
				connection_pending: 'Очікує синхронізації',
				connection_access_lost: 'Втрачено доступ',
				meta_disabled: 'Meta вимкнула кабінет',
				meta_inactive: 'Неактивний у Meta',
				postpay: 'Післяплата',
				active: 'Активний',
				client_attention: 'Потребують уваги',
				client_postpay: 'Є післяплатні',
				client_active: 'Активні кабінети',
				client_awaiting_data: 'Очікуються дані',
			} as Record<string, string>
		)[code] ?? 'Стан Meta невідомий'
	)
}
/**
 * Meta's documented `effective_status` vocabulary. The labels say *who* paused a row, so an Ad
 * paused because its Campaign is paused does not send a buyer looking for a pause on the Ad.
 * The generic fallback stays, but is now reserved for values Meta introduces later.
 */
function effectiveStatusText(status: string) {
	return (
		(
			{
				ACTIVE: 'Активне',
				PAUSED: 'Призупинене',
				ARCHIVED: 'Архівне',
				DELETED: 'Видалене',
				CAMPAIGN_PAUSED: 'Призупинено кампанією',
				ADSET_PAUSED: 'Призупинено групою оголошень',
				PENDING_REVIEW: 'На перевірці Meta',
				DISAPPROVED: 'Відхилено Meta',
				PREAPPROVED: 'Попередньо погоджено',
				PENDING_BILLING_INFO: 'Очікує платіжні дані',
				IN_PROCESS: 'Обробляється Meta',
				WITH_ISSUES: 'Є проблеми з показом',
			} as Record<string, string>
		)[status] ?? 'Статус Meta невідомий'
	)
}
function callToActionText(callToAction: string) {
	return (
		(
			{
				LEARN_MORE: 'Дізнатися більше',
				SHOP_NOW: 'Купити зараз',
				SIGN_UP: 'Зареєструватися',
				CONTACT_US: 'Зв’язатися',
				BOOK_TRAVEL: 'Забронювати подорож',
				DOWNLOAD: 'Завантажити',
				GET_QUOTE: 'Отримати пропозицію',
				SUBSCRIBE: 'Підписатися',
			} as Record<string, string>
		)[callToAction] ?? 'Дія доступна у Meta'
	)
}
function formatKpi(metric: FleetBoardMetricKey, value: string | number | null, currency: string | null) {
	if (value === null) return noData
	if (metric === 'spend' || metric === 'cpa') return formatMoney(String(value), currency)
	if (metric === 'impressions' || metric === 'clicks') return Number(value).toLocaleString('uk-UA')
	if (metric === 'results') return Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 2 })
	if (metric === 'ctr') return `${(Number(value) * 100).toLocaleString('uk-UA', { maximumFractionDigits: 2 })}%`
	// A ROAS of exactly zero means no purchase value was recorded at all, which is a missing
	// signal rather than a measured return of nothing. Spend of 0,00 stays a real number.
	if (metric === 'roas')
		return Number(value) === 0 ? noData : `${Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 2 })}×`
	return String(value)
}
function formatMoney(value: string | null, currency: string | null) {
	if (value === null || !currency) return noData
	return new Intl.NumberFormat('uk-UA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
		Number(value),
	)
}
function creativeTitle(creative: { headline: string | null; body: string | null }) {
	return (
		creative.headline?.trim() ||
		creative.body
			?.split('\n')
			.map(line => line.trim())
			.find(line => line.length > 0) ||
		'Креатив'
	)
}
function metaAdsManagerUrl(accountId: string) {
	const actId = accountId.replace(/^act_/, '')
	return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(actId)}`
}
function syncNote(accounts: Account[]) {
	const tiers = accounts.flatMap(account => [account.freshness.accountTier, account.freshness.insightsTier])
	const count = (matches: typeof tiers) => (accounts.length > 1 ? `: ${matches.length}` : '')
	const failed = tiers.filter(tier => tier.failed)
	if (failed.length > 0) return `Помилка синхронізації Meta${count(failed)}`
	const neverSynced = tiers.filter(tier => tier.refreshedAt === null)
	if (neverSynced.length > 0) return `Ще не синхронізовано${count(neverSynced)}`
	const stale = tiers.filter(tier => tier.stale)
	if (stale.length > 0) return `Дані застаріли${count(stale)}`
	return null
}
function freshnessText(value: string | null | undefined, stale: boolean, neverSynced: number) {
	const pending = neverSynced > 0 ? ` · без синхр.: ${neverSynced}` : ''
	if (!value) return `ще не синхронізовано${neverSynced > 1 ? ` (${neverSynced})` : ''}`
	const time = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
	return `${stale ? `застаріло, ${time}` : time}${pending}`
}
function mediaUrl(creativeId: string, key: string) {
	const base = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
	return `${base}/fleet-board/creatives/${encodeURIComponent(creativeId)}/media/${encodeURIComponent(key)}`
}
function LoadingState() {
	return (
		<div className="rounded-xl border bg-card p-8 text-center text-muted-foreground" aria-live="polite">
			Завантажуємо Fleet Board…
		</div>
	)
}
function EmptyState() {
	return (
		<div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
			У цій Агенції ще немає підключених рекламних кабінетів.
		</div>
	)
}
function ErrorState({ retry }: { retry: () => void }) {
	return (
		<div className="rounded-xl border bg-card p-8 text-center">
			<p className="text-muted-foreground">Не вдалося завантажити дані Fleet Board.</p>
			<Button type="button" variant="outline" onClick={retry} className="mt-3">
				<RefreshCw />
				Спробувати ще раз
			</Button>
		</div>
	)
}
