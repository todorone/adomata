import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, ImageOff, RefreshCw, Search } from 'lucide-react'
import type { FleetBoardHierarchyResponse } from '@adomata/api/client'

import { fleetBoardQueries, type FleetBoardParent, type FleetBoardRoot, useFleetBoardRoot } from '@/data/fleet-board'
import { fleetBoardMetricKeys, type FleetBoardMetricKey, type FleetBoardSearch } from '@/data/fleet-board-search'

type Account = FleetBoardRoot['accounts'][number]
type Client = FleetBoardRoot['clients'][number]
type HierarchyNode = FleetBoardHierarchyResponse['nodes'][number]
type Node = Account | HierarchyNode
type TreeRow = { node: Node; level: number; client?: Client }

const metricLabels: Record<FleetBoardMetricKey, string> = {
	spend: 'Витрати',
	impressions: 'Покази',
	clicks: 'Кліки',
	ctr: 'CTR',
	cpa: 'CPA',
	roas: 'ROAS',
}
const depthValues = ['account', 'campaign', 'adset', 'ad'] as const
const depthLabels = { account: 'Кабінети', campaign: 'Кампанії', adset: 'Групи оголошень', ad: 'Оголошення' } as const
const laneLabels = {
	needs_attention: 'Потрібна увага',
	postpay: 'Післяплата',
	active: 'Активні',
	awaiting_data: 'Очікують даних',
} as const

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

	useEffect(() => {
		if (!root.data || search.depth === 'account') return
		const parents = parentsNeededForDepth(root.data.accounts, loadedNodes, search.depth)
		if (parents.length === 0) return
		queryClient.fetchQuery(fleetBoardQueries.children(search.range, parents)).then(response => {
			setLoadedNodes(current => mergeChildren(current, response.nodes))
		})
	}, [loadedNodes, queryClient, root.data, search.depth, search.range])

	function loadChildren(parents: FleetBoardParent[]) {
		const missing = parents.filter(parent => loadedNodes[parentKey(parent.type, parent.id)] === undefined)
		if (missing.length === 0) return
		queryClient.fetchQuery(fleetBoardQueries.children(search.range, missing)).then(response => {
			setLoadedNodes(current => mergeChildren(current, response.nodes))
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

	return (
		<div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 pb-8">
			<FleetToolbar
				search={search}
				setSearch={setSearch}
				header={root.data?.header}
				clients={root.data?.clients ?? []}
			/>
			{root.isPending && !root.data ? <LoadingState /> : null}
			{root.isError ? <ErrorState retry={() => root.refetch().catch(() => undefined)} /> : null}
			{root.data && root.data.accounts.length === 0 ? <EmptyState /> : null}
			{root.data && root.data.accounts.length > 0 && search.view === 'tree' ? (
				<TreeView
					accounts={root.data.accounts}
					clients={root.data.clients}
					search={search}
					loadedNodes={loadedNodes}
					expanded={expanded}
					creativeAdId={creativeAdId}
					onToggle={toggle}
				/>
			) : null}
			{root.data && root.data.accounts.length > 0 && search.view === 'control' ? (
				<ControlRoom
					accounts={root.data.accounts}
					clients={root.data.clients}
					search={search}
					loadedNodes={loadedNodes}
					expanded={expanded}
					creativeAdId={creativeAdId}
					onToggle={toggle}
					setSearch={setSearch}
				/>
			) : null}
			{root.data && root.data.accounts.length > 0 && search.view === 'signals' ? (
				<SignalsView
					accounts={root.data.accounts}
					clients={root.data.clients}
					search={search}
					loadedNodes={loadedNodes}
					expanded={expanded}
					creativeAdId={creativeAdId}
					onToggle={toggle}
				/>
			) : null}
		</div>
	)
}

function FleetToolbar({
	search,
	setSearch,
	header,
	clients,
}: {
	search: FleetBoardSearch
	setSearch: (changes: Partial<FleetBoardSearch>) => void
	header?: FleetBoardRoot['header']
	clients: Client[]
}) {
	return (
		<section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Meta Fleet Board</p>
					<h1 className="display-title text-3xl font-semibold text-foreground">Огляд рекламних кабінетів</h1>
				</div>
				<div className="text-right text-xs text-muted-foreground" aria-live="polite">
					<div>
						Операційні дані: {freshnessText(header?.accountTierRefreshedAt, header?.accountTierStale ?? false)}
					</div>
					<div>
						Показники: {freshnessText(header?.insightsTierRefreshedAt, header?.insightsTierStale ?? false)}
					</div>
					{header?.provisional ? (
						<div className="mt-1 font-medium text-amber-700">Поточні показники можуть уточнюватися Meta.</div>
					) : null}
				</div>
			</div>
			<div className="mt-4 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Вигляд Fleet Board">
				{(
					[
						['tree', 'Дерево'],
						['control', 'Пульт'],
						['signals', 'Сигнали'],
					] as const
				).map(([view, label]) => (
					<button
						key={view}
						type="button"
						role="radio"
						aria-checked={search.view === view}
						onClick={() => setSearch({ view })}
						className={choiceClass(search.view === view)}
					>
						{label}
					</button>
				))}
			</div>
			<div className="mt-4 grid gap-3 xl:grid-cols-[auto_auto_auto_auto_1fr_auto]">
				<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
					Часовий період
					<select
						value={search.range}
						onChange={event => setSearch({ range: event.target.value as FleetBoardSearch['range'] })}
						className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
					>
						<option value="today">Сьогодні</option>
						<option value="last7">Останні 7 днів</option>
						<option value="month">З початку місяця</option>
					</select>
				</label>
				<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
					Групування
					<select
						value={search.group}
						onChange={event => setSearch({ group: event.target.value as FleetBoardSearch['group'] })}
						className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
					>
						<option value="client">За клієнтом</option>
						<option value="flat">Без групування</option>
					</select>
				</label>
				{search.group === 'flat' ? (
					<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
						Клієнт
						<select
							value={search.clientId ?? ''}
							onChange={event => setSearch({ clientId: event.target.value || undefined })}
							className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
						>
							<option value="">Усі клієнти</option>
							{clients.map(client => (
								<option key={client.id} value={client.id}>
									{client.name}
								</option>
							))}
						</select>
					</label>
				) : null}
				<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
					Глибина перегляду
					<select
						value={search.depth}
						onChange={event => setSearch({ depth: event.target.value as FleetBoardSearch['depth'] })}
						className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
					>
						{depthValues.map(value => (
							<option key={value} value={value}>
								{depthLabels[value]}
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
					Сортування
					<select
						value={search.sort}
						onChange={event => setSearch({ sort: event.target.value as FleetBoardSearch['sort'] })}
						className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
					>
						<option value="attention">Потреба уваги</option>
						<option value="name">Назва</option>
						{search.metrics.map(metric => (
							<option key={metric} value={metric}>
								{metricLabels[metric]}
							</option>
						))}
					</select>
				</label>
				<label className="flex min-w-0 items-end gap-2 rounded-md border bg-background px-2 text-sm text-muted-foreground">
					<Search size={16} />
					<input
						value={search.search}
						onChange={event => setSearch({ search: event.target.value })}
						placeholder="Пошук клієнта або кабінету"
						className="h-9 min-w-0 flex-1 bg-transparent outline-none"
					/>
				</label>
				<label className="flex items-end gap-2 text-sm text-foreground">
					<input
						checked={search.needsAttention}
						onChange={event => setSearch({ needsAttention: event.target.checked })}
						type="checkbox"
					/>
					Потрібна увага
				</label>
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Вибір показників">
				<span className="mr-1 text-xs font-semibold text-muted-foreground">Показники</span>
				{fleetBoardMetricKeys.map(metric => {
					const active = search.metrics.includes(metric)
					return (
						<button
							key={metric}
							type="button"
							aria-pressed={active}
							onClick={() => setSearch({ metrics: nextMetrics(search, metric) })}
							className={choiceClass(active)}
						>
							{metricLabels[metric]}
						</button>
					)
				})}
			</div>
		</section>
	)
}

function TreeView({
	accounts,
	clients,
	search,
	loadedNodes,
	expanded,
	creativeAdId,
	onToggle,
}: {
	accounts: Account[]
	clients: Client[]
	search: FleetBoardSearch
	loadedNodes: Record<string, HierarchyNode[]>
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
}) {
	const rows = flattenRows(accounts, clients, search.group, search.depth, loadedNodes, expanded)
	const scrollRef = useRef<HTMLDivElement>(null)
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 58,
		overscan: 8,
	})
	return (
		<section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
			<div className="overflow-x-auto">
				<div
					className="grid min-w-[760px] border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground"
					style={{ gridTemplateColumns: columns(search.metrics) }}
				>
					<span>Структура</span>
					<span>Стан</span>
					{search.metrics.map(metric => (
						<span key={metric} className="text-right">
							{metricLabels[metric]}
						</span>
					))}
				</div>
				<div
					ref={scrollRef}
					className="h-[min(68vh,780px)] overflow-auto"
					role="treegrid"
					aria-label="Дерево рекламних кабінетів"
				>
					<div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: 760 }}>
						{virtualizer.getVirtualItems().map(item => {
							const row = rows[item.index]!
							return (
								<div
									key={rowKey(row, item.index)}
									ref={virtualizer.measureElement}
									data-index={item.index}
									style={{
										position: 'absolute',
										top: 0,
										left: 0,
										width: '100%',
										transform: `translateY(${item.start}px)`,
									}}
								>
									{row.kind === 'client' ? (
										<ClientRow row={row.client} metrics={search.metrics} />
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
		</section>
	)
}

function ControlRoom({
	accounts,
	clients,
	search,
	loadedNodes,
	expanded,
	creativeAdId,
	onToggle,
	setSearch,
}: {
	accounts: Account[]
	clients: Client[]
	search: FleetBoardSearch
	loadedNodes: Record<string, HierarchyNode[]>
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
	setSearch: (changes: Partial<FleetBoardSearch>) => void
}) {
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
		estimateSize: () => 54,
		overscan: 8,
	})
	return (
		<section className="grid overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:grid-cols-[minmax(260px,0.34fr)_minmax(0,1fr)]">
			<aside
				className="border-b bg-muted/35 p-3 lg:max-h-[75vh] lg:overflow-auto lg:border-r lg:border-b-0"
				aria-label="Список рекламних кабінетів"
			>
				<div
					ref={railRef}
					className="max-h-64 overflow-auto lg:max-h-none"
					style={{ height: Math.min(railItems.length * 54, 600) }}
				>
					<div style={{ height: rail.getTotalSize(), position: 'relative' }}>
						{rail.getVirtualItems().map(item => {
							const itemValue = railItems[item.index]!
							if ('client' in itemValue) {
								return (
									<p
										key={`client:${itemValue.client.id}`}
										className="absolute w-full px-2 py-2 text-xs font-semibold text-muted-foreground"
										style={{ transform: `translateY(${item.start}px)` }}
									>
										{itemValue.client.name}
									</p>
								)
							}
							const { account } = itemValue
							return (
								<button
									key={account.id}
									type="button"
									onClick={() => setSearch({ account: account.id })}
									className={`absolute flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${account.id === selected.id ? 'bg-background shadow-sm' : ''}`}
									style={{ transform: `translateY(${item.start}px)` }}
								>
									<HealthLabel health={account.health} />
									<span className="min-w-0 flex-1 truncate">{account.name}</span>
								</button>
							)
						})}
					</div>
				</div>
			</aside>
			<div className="min-w-0 p-4">
				<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
					<div>
						<p className="text-xs text-muted-foreground">{selected.clientName}</p>
						<h2 className="text-xl font-semibold">{selected.name}</h2>
					</div>
					<HealthLabel health={selected.health} />
				</div>
				<TreeView
					accounts={[selected]}
					clients={clients.filter(client => client.id === selected.clientId)}
					search={{ ...search, group: 'flat' }}
					loadedNodes={loadedNodes}
					expanded={expanded}
					creativeAdId={creativeAdId}
					onToggle={onToggle}
				/>
			</div>
		</section>
	)
}

function SignalsView({
	accounts,
	clients,
	search,
	loadedNodes,
	expanded,
	creativeAdId,
	onToggle,
}: {
	accounts: Account[]
	clients: Client[]
	search: FleetBoardSearch
	loadedNodes: Record<string, HierarchyNode[]>
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
}) {
	const [openedClients, setOpenedClients] = useState<Set<string>>(new Set())
	const items = search.group === 'client' ? clients : accounts
	return (
		<div className="grid gap-4 xl:grid-cols-2">
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
	const scrollRef = useRef<HTMLDivElement>(null)
	const virtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 130,
		overscan: 5,
	})
	return (
		<section className="rounded-2xl border border-border bg-card p-3 shadow-sm" aria-labelledby={`lane-${lane}`}>
			<header className="mb-3 flex items-center justify-between">
				<h2 id={`lane-${lane}`} className="font-semibold">
					{laneLabels[lane]}
				</h2>
				<span className="rounded-full bg-muted px-2 py-0.5 text-xs">{items.length}</span>
			</header>
			<div ref={scrollRef} className="max-h-[56vh] overflow-auto">
				<div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
					{virtualizer.getVirtualItems().map(item => {
						const value = items[item.index]!
						const isClient = !('type' in value)
						const isOpen = isClient ? openedClients.has(value.id) : expanded.has(parentKey('account', value.id))
						const childAccounts = isClient ? accounts.filter(account => account.clientId === value.id) : [value]
						return (
							<article
								key={value.id}
								ref={virtualizer.measureElement}
								data-index={item.index}
								className="absolute w-full rounded-xl border bg-background p-3"
								style={{ transform: `translateY(${item.start}px)` }}
							>
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
									<div>
										<p className="font-medium">{value.name}</p>
										{isClient ? null : <p className="text-xs text-muted-foreground">{value.clientName}</p>}
									</div>
									<HealthLabel health={value.health} />
								</button>
								<KpiStrip
									kpis={value.kpis}
									metrics={search.metrics}
									currency={isClient ? value.currency : value.currency}
								/>
								{isOpen ? (
									<div className="mt-3 border-t pt-2">
										{childAccounts
											.flatMap(account => flattenAccount(account, search.depth, loadedNodes, expanded))
											.map(row => (
												<NodeRow
													key={`${row.node.type}:${row.node.id}`}
													row={row}
													metrics={search.metrics}
													expanded={expanded}
													creativeAdId={creativeAdId}
													onToggle={onToggle}
													compact
												/>
											))}
									</div>
								) : null}
							</article>
						)
					})}
				</div>
			</div>
		</section>
	)
}

function ClientRow({ row, metrics }: { row: Client; metrics: FleetBoardMetricKey[] }) {
	return (
		<div
			className="grid min-h-12 items-center border-b bg-muted/35 px-3 text-sm font-semibold"
			style={{ gridTemplateColumns: columns(metrics) }}
		>
			<span>
				{row.name}
				{row.mixedTimezone ? (
					<small className="ml-2 font-normal text-muted-foreground">кілька часових поясів</small>
				) : null}
			</span>
			<HealthLabel health={row.health} />
			{metrics.map(metric => (
				<KpiCell key={metric} metric={metric} kpis={row.kpis} currency={row.currency} />
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
	compact = false,
}: {
	row: TreeRow
	metrics: FleetBoardMetricKey[]
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
	compact?: boolean
}) {
	const { node } = row
	const isExpandable = node.type !== 'ad'
	const isExpanded = node.type === 'ad' ? creativeAdId === node.id : expanded.has(parentKey(node.type, node.id))
	return (
		<div
			className={`border-b px-3 py-2 ${compact ? 'text-sm' : ''}`}
			role="row"
			aria-level={row.level + 1}
			aria-expanded={isExpandable ? isExpanded : undefined}
		>
			<div className="grid min-h-9 items-center gap-2" style={{ gridTemplateColumns: columns(metrics) }}>
				<button
					type="button"
					onClick={() => onToggle(node)}
					className="flex min-w-0 items-center gap-1 text-left"
					style={{ paddingInlineStart: row.level * 18 }}
					aria-label={
						node.type === 'ad'
							? `Відкрити креатив ${node.name}`
							: `${isExpanded ? 'Згорнути' : 'Розгорнути'} ${node.name}`
					}
				>
					{isExpandable ? (
						<ChevronRight
							size={16}
							className={isExpanded ? 'rotate-90 transition-transform' : 'transition-transform'}
						/>
					) : (
						<span className="w-4" />
					)}
					<span className="truncate">{node.name}</span>
				</button>
				<span className="text-xs text-muted-foreground">
					{'connectionStatus' in node
						? node.kpis.running
							? 'Є активні'
							: 'Неактивні'
						: effectiveStatusText(node.effectiveStatus)}
				</span>
				{metrics.map(metric => (
					<KpiCell
						key={metric}
						metric={metric}
						kpis={node.kpis}
						currency={'currency' in node ? node.currency : null}
					/>
				))}
			</div>
			{'type' in node && node.type === 'account' ? (
				<div className="mt-1" style={{ paddingInlineStart: row.level * 18 + 20 }}>
					<HealthLabel health={node.health} />
					<span className="ml-3 text-xs text-muted-foreground">
						Заборгованість: {node.amountOwed === null ? '—' : formatKpi('spend', node.amountOwed, node.currency)}
					</span>
				</div>
			) : null}
			{node.type === 'ad' && creativeAdId === node.id ? <CreativeDetail adId={node.id} /> : null}
		</div>
	)
}

function CreativeDetail({ adId }: { adId: string }) {
	const creative = useQuery(fleetBoardQueries.creative(adId))
	if (creative.isPending)
		return (
			<p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
				Завантажуємо креатив…
			</p>
		)
	if (creative.isError || !creative.data)
		return (
			<p className="mt-3 text-sm text-muted-foreground">
				Не вдалося завантажити креатив. Показники оголошення доступні.
			</p>
		)
	return (
		<div className="mt-3 rounded-lg border bg-muted/20 p-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<p className="font-medium">{creative.data.name ?? 'Креатив'}</p>
					<p className="text-sm text-muted-foreground">
						{creative.data.headline ?? creative.data.body ?? 'Текст креативу недоступний'}
					</p>
					{creative.data.callToAction ? (
						<p className="mt-1 text-xs text-muted-foreground">
							Дія: {callToActionText(creative.data.callToAction)}
						</p>
					) : null}
					{creative.data.description ? (
						<p className="mt-1 text-xs text-muted-foreground">{creative.data.description}</p>
					) : null}
					{creative.data.destination ? (
						<a
							className="mt-1 block text-xs text-primary underline"
							href={creative.data.destination}
							target="_blank"
							rel="noreferrer"
						>
							Перейти за посиланням
						</a>
					) : null}
					{creative.data.existingPostId ? (
						<p className="mt-1 text-xs text-muted-foreground">
							Ідентифікатор допису: {creative.data.existingPostId}
						</p>
					) : null}
				</div>
				<span className="rounded-full bg-muted px-2 py-1 text-xs">Результати належать оголошенню цілком</span>
			</div>
			<div className="mt-3 flex flex-wrap gap-2">
				{creative.data.assets.map(asset => (
					<div key={asset.key} className="w-32 overflow-hidden rounded-md border bg-background">
						{asset.mediaKey ? (
							<img
								src={mediaUrl(creative.data!.id, asset.mediaKey)}
								alt={asset.label}
								className="aspect-square w-full object-cover"
							/>
						) : (
							<div className="flex aspect-square items-center justify-center bg-muted p-2 text-center text-xs text-muted-foreground">
								{asset.kind === 'image' || asset.kind === 'video' ? 'Медіафайл' : (asset.value ?? asset.label)}
							</div>
						)}
						<p className="truncate px-2 py-1 text-xs">
							{asset.label}
							{asset.value ? `: ${asset.value}` : ''}
						</p>
					</div>
				))}
				{creative.data.mediaUnavailable ? (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<ImageOff size={16} />
						Медіа тимчасово недоступне
					</div>
				) : null}
			</div>
		</div>
	)
}

function HealthLabel({ health }: { health: { color: string; reason: { code: string }; needsAttention: boolean } }) {
	return (
		<span
			className="inline-flex items-center gap-1.5 text-xs"
			aria-label={`${healthText(health.reason.code)}${health.needsAttention ? ', потрібна увага' : ''}`}
		>
			<span className={`h-2.5 w-2.5 rounded-full ${healthColorClass(health.color)}`} />
			<span>{healthText(health.reason.code)}</span>
		</span>
	)
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
		<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
	return <span className="text-right text-sm tabular-nums">{formatKpi(metric, kpis[metric], currency)}</span>
}

function flattenRows(
	accounts: Account[],
	clients: Client[],
	group: FleetBoardSearch['group'],
	depth: FleetBoardSearch['depth'],
	children: Record<string, HierarchyNode[]>,
	expanded: Set<string>,
) {
	const rows: Array<{ kind: 'client'; client: Client } | { kind: 'node'; node: Node; level: number }> = []
	if (group === 'flat')
		return accounts.flatMap(account =>
			flattenAccount(account, depth, children, expanded).map(row => ({ kind: 'node' as const, ...row })),
		)
	for (const client of clients) {
		rows.push({ kind: 'client', client })
		for (const account of accounts.filter(account => account.clientId === client.id))
			rows.push(
				...flattenAccount(account, depth, children, expanded).map(row => ({ kind: 'node' as const, ...row })),
			)
	}
	return rows
}

function flattenAccount(
	account: Account,
	depth: FleetBoardSearch['depth'],
	children: Record<string, HierarchyNode[]>,
	expanded: Set<string>,
) {
	return flattenNode(account, 0, depth, children, expanded)
}

function flattenNode(
	node: Node,
	level: number,
	depth: FleetBoardSearch['depth'],
	children: Record<string, HierarchyNode[]>,
	expanded: Set<string>,
): TreeRow[] {
	const rows: TreeRow[] = [{ node, level }]
	if (node.type === 'ad') return rows
	const typeDepth = depthValues.indexOf(node.type)
	if (depthValues.indexOf(depth) <= typeDepth && !expanded.has(parentKey(node.type, node.id))) return rows
	for (const child of children[parentKey(node.type, node.id)] ?? [])
		rows.push(...flattenNode(child, level + 1, depth, children, expanded))
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

function mergeChildren(current: Record<string, HierarchyNode[]>, nodes: HierarchyNode[]) {
	const next = { ...current }
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
function rowKey(row: ReturnType<typeof flattenRows>[number], index: number) {
	return row.kind === 'client' ? `client:${row.client.id}` : `${row.node.type}:${row.node.id}:${index}`
}
function columns(metrics: FleetBoardMetricKey[]) {
	return `minmax(260px, 1.8fr) minmax(130px, .8fr) repeat(${metrics.length}, minmax(96px, .55fr))`
}
function nextMetrics(search: FleetBoardSearch, metric: FleetBoardMetricKey) {
	const metrics = search.metrics.includes(metric)
		? search.metrics.filter(value => value !== metric)
		: [...search.metrics, metric]
	return metrics.length ? metrics : search.metrics
}
function choiceClass(active: boolean) {
	return `rounded-md border px-3 py-1.5 text-sm font-medium ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-muted'}`
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
				connection_pending: 'Очікується перша синхронізація',
				connection_access_lost: 'Втрачено доступ до Meta',
				meta_disabled: 'Meta вимкнула кабінет',
				meta_inactive: 'Кабінет неактивний у Meta',
				postpay: 'Післяплатний кабінет',
				active: 'Активний',
				client_attention: 'Є кабінети, що потребують уваги',
				client_postpay: 'Є післяплатні кабінети',
				client_active: 'Активні кабінети',
				client_awaiting_data: 'Очікуються дані',
			} as Record<string, string>
		)[code] ?? 'Стан Meta невідомий'
	)
}
function effectiveStatusText(status: string) {
	return (
		(
			{ ACTIVE: 'Активне', PAUSED: 'Призупинене', ARCHIVED: 'Архівне', DELETED: 'Видалене' } as Record<
				string,
				string
			>
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
	if (value === null) return '—'
	if (metric === 'spend' || metric === 'cpa')
		return currency
			? new Intl.NumberFormat('uk-UA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
					Number(value),
				)
			: '—'
	if (metric === 'impressions' || metric === 'clicks') return Number(value).toLocaleString('uk-UA')
	if (metric === 'ctr') return `${(Number(value) * 100).toLocaleString('uk-UA', { maximumFractionDigits: 2 })}%`
	if (metric === 'roas') return `${Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 2 })}×`
	return String(value)
}
function freshnessText(value: string | null | undefined, stale: boolean) {
	if (!value) return 'ще не синхронізовано'
	const time = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
	return stale ? `застаріло, ${time}` : time
}
function mediaUrl(creativeId: string, key: string) {
	const base = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
	return `${base}/fleet-board/creatives/${encodeURIComponent(creativeId)}/media/${encodeURIComponent(key)}`
}
function LoadingState() {
	return (
		<div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground" aria-live="polite">
			Завантажуємо Fleet Board…
		</div>
	)
}
function EmptyState() {
	return (
		<div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground">
			У цій Агенції ще немає підключених рекламних кабінетів.
		</div>
	)
}
function ErrorState({ retry }: { retry: () => void }) {
	return (
		<div className="rounded-2xl border bg-card p-8 text-center">
			<p className="text-muted-foreground">Не вдалося завантажити дані Fleet Board.</p>
			<button
				type="button"
				onClick={retry}
				className="mt-3 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
			>
				<RefreshCw size={16} />
				Спробувати ще раз
			</button>
		</div>
	)
}
