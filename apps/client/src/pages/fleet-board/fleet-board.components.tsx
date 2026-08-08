import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
	X,
} from 'lucide-react'

import { DateRangePicker } from '@/components/date-range-picker'
import { Lightbox } from '@/components/lightbox'
import { fleetBoardQueries, type FleetBoardRoot } from '@/data/fleet-board'
import { fleetBoardMetricKeys, type FleetBoardMetricKey, type FleetBoardSearch } from '@/data/fleet-board-search'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip'
import {
	callToActionText,
	creativeTitle,
	effectiveStatusText,
	flattenAccount,
	flattenRows,
	formatKpi,
	formatMoney,
	freshnessText,
	gridMinWidth,
	gridTemplate,
	healthColorClass,
	healthText,
	mediaUrl,
	metaAdsManagerUrl,
	nextMetrics,
	parentKey,
	syncNote,
	type Account,
	type Client,
	type HierarchyNode,
	type Node,
	type SortKey,
	type TreeRow,
} from './fleet-board.logic'

const metricLabels: Record<FleetBoardMetricKey, string> = {
	spend: 'Витрати',
	impressions: 'Покази',
	clicks: 'Кліки',
	ctr: 'CTR',
	cpa: 'CPA',
	results: 'Результати',
	roas: 'ROAS',
}
const depthLabels = { account: 'Кабінети', campaign: 'Кампанії', adset: 'Групи оголошень', ad: 'Оголошення' } as const
const groupLabels = { client: 'За клієнтом', flat: 'Без групування' } as const
const viewLabels = { tree: 'Дерево', control: 'Пульт', signals: 'Сигнали' } as const
const laneLabels = {
	needs_attention: 'Потрібна увага',
	postpay: 'Післяплата',
	active: 'Активні',
	awaiting_data: 'Очікують даних',
} as const

export type ViewProps = {
	accounts: Account[]
	clients: Client[]
	search: FleetBoardSearch
	setSearch: (changes: Partial<FleetBoardSearch>) => void
	loadedNodes: Record<string, HierarchyNode[]>
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
}

export function FleetToolbar({
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

export function TreeView({
	accounts,
	clients,
	search,
	setSearch,
	loadedNodes,
	expanded,
	creativeAdId,
	onToggle,
}: ViewProps) {
	const rows = flattenRows(accounts, clients, search, loadedNodes, expanded)
	const scrollRef = useRef<HTMLDivElement>(null)
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 36,
		overscan: 12,
	})
	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
			<div className="flex min-h-0 flex-1 flex-col overflow-x-auto">
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

export function ControlRoom({
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

export function SignalsView({ accounts, clients, search, loadedNodes, expanded, creativeAdId, onToggle }: ViewProps) {
	const [openedClients, setOpenedClients] = useState<Set<string>>(new Set())
	const items = search.group === 'client' ? clients : accounts
	return (
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
									<HealthLabel health={value.health} muted={value.signalsLane === lane} />
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
		(asset): asset is typeof asset & { kind: 'image' | 'video'; mediaKey: string } =>
			asset.mediaKey !== null && (asset.kind === 'image' || asset.kind === 'video'),
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
					{data.assets.length > 1 ? (
						<span className="rounded-full bg-muted px-2 py-1 text-xs">Результати належать оголошенню цілком</span>
					) : null}
					<Button type="button" size="icon-sm" variant="ghost" onClick={onClose} aria-label="Закрити креатив">
						<X />
					</Button>
				</div>
			</div>
			{mediaAssets.length > 0 ? (
				<Lightbox
					assets={mediaAssets}
					selectedAssetKey={selectedAsset?.key ?? null}
					onSelectedAssetChange={setSelectedAssetKey}
					mediaUnavailable={data.mediaUnavailable}
					mediaUrl={mediaKey => mediaUrl(data.id, mediaKey)}
					metadata={{
						title: creativeTitle(data),
						body: data.body,
						description: data.description,
						callToAction: data.callToAction ? callToActionText(data.callToAction) : null,
						destination: data.destination,
					}}
					hasMultipleAssets={data.assets.length > 1}
				/>
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

export function LoadingState() {
	return (
		<div className="rounded-xl border bg-card p-8 text-center text-muted-foreground" aria-live="polite">
			Завантажуємо Fleet Board…
		</div>
	)
}
export function EmptyState() {
	return (
		<div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
			У цій Агенції ще немає підключених рекламних кабінетів.
		</div>
	)
}
export function ErrorState({ retry }: { retry: () => void }) {
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
