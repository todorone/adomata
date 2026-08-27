import { useEffect, useRef, useState, type DragEventHandler, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
	flexRender,
	getCoreRowModel,
	useReactTable,
	type Column,
	type ColumnDef,
	type Header,
	type Row,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	Check,
	ChevronRight,
	CircleAlert,
	Columns3,
	Copy,
	ExternalLink,
	GripVertical,
	Image as ImageIcon,
	RefreshCw,
	RotateCcw,
	Search,
	Settings2,
	SlidersHorizontal,
	TriangleAlert,
	Video,
} from 'lucide-react'

import { DateRangePicker } from '@/components/date-range-picker'
import { Lightbox } from '@/components/lightbox'
import { fleetBoardParentKey, fleetBoardQueries, type FleetBoardRoot } from '@/data/fleet-board'
import { fleetBoardMetricKeys, type FleetBoardMetricKey, type FleetBoardSearch } from '@/data/fleet-board-search'
import { useMe } from '@/data/me'
import { useColumnLayoutPersistence, type ColumnLayoutColumn } from '@/lib/column-layout-persistence'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip'
import {
	callToActionText,
	creativeTitle,
	effectiveStatusText,
	flattenAccount,
	flattenRows,
	formatKpi,
	gridMinWidth,
	gridTemplate,
	healthColorClass,
	healthText,
	mediaUrl,
	metaAdsManagerUrl,
	nextMetrics,
	reorderColumnIds,
	syncFindingActionText,
	syncFindingAvailabilityText,
	syncFindingCauseText,
	syncFindingShowsForceRefresh,
	syncFindingShowsReconnect,
	syncSeverityIconColorClass,
	syncSliceText,
	type Account,
	type BoardRow,
	type Client,
	type NodeIndex,
	type Node,
	type SortKey,
	type SyncFinding,
	type SyncHealth,
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
const columnLabels: Record<string, string> = {
	structure: 'Структура',
	health: 'Здоров’я',
	status: 'Стан',
}
const depthLabels = { account: 'Кабінети', campaign: 'Кампанії', adset: 'Групи оголошень', ad: 'Оголошення' } as const
const viewLabels = { tree: 'Дерево', control: 'Пульт', signals: 'Сигнали' } as const
const laneLabels = {
	needs_attention: 'Потрібна увага',
	postpay: 'Післяплата',
	active: 'Активні',
} as const

export type ViewProps = {
	accounts: Account[]
	search: FleetBoardSearch
	setSearch: (changes: Partial<FleetBoardSearch>) => void
	columnLayoutKey: string | null
	nodeIndex: NodeIndex
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
	onRefresh: () => void
}

export function FleetToolbar({
	search,
	setSearch,
	header,
	clients,
	accounts,
	onRefresh,
	refreshDisabled,
	refreshPending,
	forceRefreshCooldownMessage,
	forceRefreshError,
}: {
	search: FleetBoardSearch
	setSearch: (changes: Partial<FleetBoardSearch>) => void
	header?: FleetBoardRoot['header']
	clients: Client[]
	accounts: Account[]
	onRefresh: () => void
	refreshDisabled: boolean
	refreshPending: boolean
	forceRefreshCooldownMessage: string | null
	forceRefreshError: string | null
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
					{header?.provisional ? (
						<span className="font-medium text-amber-700 dark:text-amber-400">Уточнюється Meta.</span>
					) : null}
					{forceRefreshCooldownMessage ? <span>{forceRefreshCooldownMessage}</span> : null}
				</p>
				<FleetSyncHealthAggregate syncHealth={header?.syncHealth} accounts={accounts} onRefresh={onRefresh} />
				{forceRefreshError ? (
					<span className="text-destructive" aria-label="Не вдалося оновити дані" title={forceRefreshError}>
						<CircleAlert size={16} aria-hidden />
					</span>
				) : null}
				<TooltipProvider delayDuration={0}>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								aria-label="Оновити дані"
								onClick={onRefresh}
								disabled={refreshDisabled}
							>
								<RefreshCw className={refreshPending ? 'animate-spin' : undefined} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>{refreshPending ? 'Оновлюємо дані…' : 'Оновити дані'}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<DateRangePicker value={search.range} onChange={range => setSearch({ range })} />
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
	search,
	setSearch,
	columnLayoutKey,
	nodeIndex,
	expanded,
	creativeAdId,
	onToggle,
	onRefresh,
}: ViewProps) {
	const rows = flattenRows(accounts, search, nodeIndex, expanded)
	const columns = createFleetColumns({
		metrics: search.metrics,
		search,
		setSearch,
		onToggle,
		onRefresh,
		isExpanded: node =>
			node.type === 'ad' ? creativeAdId === node.id : expanded.has(fleetBoardParentKey(node.type, node.id)),
	})
	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
			<FleetDataTable
				rows={rows}
				columns={columns}
				metrics={search.metrics}
				columnLayoutKey={columnLayoutKey}
				sort={search.sort}
				direction={search.direction}
				expanded={expanded}
				renderExpandedRow={row =>
					row.node.type === 'ad' && creativeAdId === row.node.id ? (
						<CreativeDetail adId={row.node.id} onClose={() => onToggle(row.node)} />
					) : null
				}
				onToggle={onToggle}
			/>
		</section>
	)
}

type FleetTableColumnOptions = {
	metrics: FleetBoardMetricKey[]
	search: FleetBoardSearch
	setSearch: (changes: Partial<FleetBoardSearch>) => void
	onToggle: (node: Node) => void
	onRefresh: () => void
	isExpanded: (node: Node) => boolean
}

function createFleetColumns({
	metrics,
	search,
	setSearch,
	onToggle,
	onRefresh,
	isExpanded,
}: FleetTableColumnOptions): ColumnDef<BoardRow>[] {
	function sortBy(sort: SortKey) {
		setSearch(
			search.sort === sort
				? { direction: search.direction === 'asc' ? 'desc' : 'asc' }
				: { sort, direction: 'desc' },
		)
	}

	return [
		{
			id: 'structure',
			accessorFn: row => row.node.name,
			size: 220,
			minSize: 180,
			maxSize: 480,
			header: () => <SortableHeader label="Структура" sort="name" search={search} onSort={sortBy} />,
			cell: ({ row }) => (
				<NodeNameCell row={row.original} onToggle={onToggle} isExpanded={isExpanded(row.original.node)} />
			),
		},
		{
			id: 'health',
			size: 160,
			minSize: 132,
			maxSize: 320,
			header: () => <SortableHeader label="Здоров’я" sort="attention" search={search} onSort={sortBy} />,
			cell: ({ row }) => <NodeHealthCell node={row.original.node} onRefresh={onRefresh} />,
		},
		{
			id: 'status',
			size: 112,
			minSize: 84,
			maxSize: 240,
			header: 'Стан',
			cell: ({ row }) => <NodeStateCell node={row.original.node} />,
		},
		...metrics.map<ColumnDef<BoardRow>>(metric => ({
			id: metric,
			accessorFn: row => row.node.kpis[metric],
			size: 112,
			minSize: 88,
			maxSize: 280,
			header: () => (
				<SortableHeader label={metricLabels[metric]} sort={metric} search={search} onSort={sortBy} alignRight />
			),
			cell: ({ row }) => <KpiCell metric={metric} kpis={row.original.node.kpis} currency={row.original.currency} />,
		})),
	]
}

function SortableHeader({
	label,
	sort,
	search,
	onSort,
	alignRight = false,
}: {
	label: string
	sort: SortKey
	search: FleetBoardSearch
	onSort: (sort: SortKey) => void
	alignRight?: boolean
}) {
	const active = search.sort === sort
	return (
		<Button
			type="button"
			variant="ghost"
			size="xs"
			className={`h-6 w-full px-1 text-xs text-muted-foreground hover:text-foreground ${alignRight ? 'justify-end' : 'justify-start'}`}
			onClick={() => onSort(sort)}
			aria-label={`Сортувати за: ${label}`}
		>
			{label}
			{active ? search.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
		</Button>
	)
}

type FleetDataTableProps = {
	rows: BoardRow[]
	columns: ColumnDef<BoardRow>[]
	metrics: FleetBoardMetricKey[]
	columnLayoutKey: string | null
	sort: SortKey
	direction: FleetBoardSearch['direction']
	expanded: Set<string>
	onToggle: (node: Node) => void
	renderExpandedRow: (row: BoardRow) => ReactNode
}

type FleetDisplayRow = { kind: 'data'; row: Row<BoardRow> } | { kind: 'detail'; row: Row<BoardRow>; content: ReactNode }

function columnLabel(id: string) {
	return columnLabels[id] ?? metricLabels[id as FleetBoardMetricKey] ?? id
}

function ColumnDragHandle({
	label,
	onDragStart,
	onDragEnd,
}: {
	label: string
	onDragStart: DragEventHandler<HTMLButtonElement>
	onDragEnd: DragEventHandler<HTMLButtonElement>
}) {
	return (
		<button
			type="button"
			draggable
			aria-label={`Перемістити стовпець «${label}»`}
			title="Перетягнути стовпець"
			className="-ml-1 inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/70 hover:bg-accent hover:text-foreground active:cursor-grabbing"
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
		>
			<GripVertical size={14} />
		</button>
	)
}

function ColumnResizeHandle({
	header,
	label,
	size,
	onResizeByKeyboard,
}: {
	header: Header<BoardRow, unknown>
	label: string
	size: number
	onResizeByKeyboard: (column: Column<BoardRow>, delta: number) => void
}) {
	const min = header.column.columnDef.minSize ?? 20
	const max = header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER
	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={`Змінити ширину стовпця «${label}»`}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={Math.round(size)}
			tabIndex={0}
			title="Потягніть, щоб змінити ширину"
			className="absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize touch-none select-none rounded-full outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:content-[''] after:bg-border hover:after:bg-primary/50 focus-visible:after:bg-primary focus-visible:ring-2 focus-visible:ring-ring/50"
			onMouseDown={header.getResizeHandler()}
			onTouchStart={header.getResizeHandler()}
			onClick={event => event.stopPropagation()}
			onKeyDown={event => {
				if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
				event.preventDefault()
				onResizeByKeyboard(header.column, event.key === 'ArrowRight' ? 8 : -8)
			}}
		/>
	)
}

function FleetColumnSettings({
	columns,
	onMove,
	onReset,
}: {
	columns: Column<BoardRow>[]
	onMove: (columnId: string, direction: -1 | 1) => void
	onReset: () => void
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button type="button" size="sm" variant="outline" aria-label="Налаштувати стовпці">
					<Settings2 />
					<span className="hidden sm:inline">Стовпці</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="flex flex-col gap-2" aria-label="Налаштування стовпців">
				<div>
					<p className="text-sm font-medium">Налаштування стовпців</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Перетягніть ручку в заголовку або скористайтеся стрілками. Ширину змінюйте за краєм заголовка.
					</p>
				</div>
				<div className="flex flex-col gap-1" role="list" aria-label="Порядок стовпців">
					{columns.map((column, index) => (
						<div key={column.id} role="listitem" className="flex items-center gap-1 rounded-md border px-1 py-1">
							<span className="min-w-0 flex-1 truncate px-1 text-sm">{columnLabel(column.id)}</span>
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								disabled={index === 0}
								aria-label={`Перемістити «${columnLabel(column.id)}» ліворуч`}
								onClick={() => onMove(column.id, -1)}
							>
								<ArrowLeft />
							</Button>
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								disabled={index === columns.length - 1}
								aria-label={`Перемістити «${columnLabel(column.id)}» праворуч`}
								onClick={() => onMove(column.id, 1)}
							>
								<ArrowRight />
							</Button>
						</div>
					))}
				</div>
				<Button type="button" size="sm" variant="outline" className="w-full" onClick={onReset}>
					<RotateCcw />
					Скинути порядок і ширину
				</Button>
			</PopoverContent>
		</Popover>
	)
}

function FleetDataTable({
	rows,
	columns,
	metrics,
	columnLayoutKey,
	sort,
	direction,
	expanded,
	onToggle,
	renderExpandedRow,
}: FleetDataTableProps) {
	const scrollRef = useRef<HTMLDivElement>(null)
	const layoutColumns = columns.flatMap<ColumnLayoutColumn>(column =>
		column.id
			? [
					{
						id: column.id,
						minSize: column.minSize,
						maxSize: column.maxSize,
					},
				]
			: [],
	)
	const {
		columnOrder,
		columnSizing,
		onColumnOrderChange,
		onColumnSizingChange,
		persistColumnLayout,
		resetColumnLayout,
	} = useColumnLayoutPersistence({ columns: layoutColumns, storageKey: columnLayoutKey })
	const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null)
	const [dropTargetId, setDropTargetId] = useState<string | null>(null)
	const [columnMessage, setColumnMessage] = useState('')
	const table = useReactTable({
		data: rows,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getRowId: row => row.key,
		state: { columnOrder, columnSizing },
		onColumnOrderChange,
		onColumnSizingChange,
		columnResizeMode: 'onEnd',
		defaultColumn: { size: 112, minSize: 88, maxSize: 480 },
	})
	const resizingColumnId = table.getState().columnSizingInfo.isResizingColumn
	useEffect(() => {
		if (!resizingColumnId) return
		const previousCursor = document.body.style.cursor
		const previousUserSelect = document.body.style.userSelect
		document.body.style.cursor = 'col-resize'
		document.body.style.userSelect = 'none'
		return () => {
			document.body.style.cursor = previousCursor
			document.body.style.userSelect = previousUserSelect
			persistColumnLayout()
		}
	}, [persistColumnLayout, resizingColumnId])
	const displayRows = table.getRowModel().rows.flatMap<FleetDisplayRow>(row => {
		const content = renderExpandedRow(row.original)
		return content
			? [
					{ kind: 'data' as const, row },
					{ kind: 'detail' as const, row, content },
				]
			: [{ kind: 'data' as const, row }]
	})
	const virtualizer = useVirtualizer({
		count: displayRows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: index => (displayRows[index]?.kind === 'detail' ? 240 : 36),
		overscan: 12,
	})
	const virtualItems = virtualizer.getVirtualItems()
	const firstItem = virtualItems[0]
	const lastItem = virtualItems[virtualItems.length - 1]
	const columnSort = (columnId: string): SortKey | null => {
		if (columnId === 'structure') return 'name'
		if (columnId === 'health') return 'attention'
		if (metrics.includes(columnId as FleetBoardMetricKey)) return columnId as FleetBoardMetricKey
		return null
	}
	const columnClass = (columnId: string) => {
		return columnId === 'structure' || columnId === 'health' || columnId === 'status' ? '' : 'text-right'
	}
	const moveColumn = (columnId: string, direction: -1 | 1) => {
		const index = columnOrder.indexOf(columnId)
		const target = columnOrder[index + direction]
		if (!target) return
		onColumnOrderChange(current => {
			return reorderColumnIds(current, columnId, target)
		})
		setColumnMessage(`Стовпець «${columnLabel(columnId)}» переміщено на позицію ${index + direction + 1}.`)
	}
	const resetColumns = () => {
		resetColumnLayout()
		setColumnMessage('Порядок і ширину стовпців скинуто.')
	}
	const resizeByKeyboard = (column: Column<BoardRow>, delta: number) => {
		const min = column.columnDef.minSize ?? 20
		const max = column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER
		table.setColumnSizing(current => ({
			...current,
			[column.id]: Math.min(max, Math.max(min, (current[column.id] ?? column.getSize()) + delta)),
		}))
		persistColumnLayout()
	}
	const spacer = (height: number, key: string) =>
		height > 0 ? (
			<TableRow key={key} aria-hidden className="border-0 hover:bg-transparent">
				<TableCell colSpan={columns.length} className="p-0" style={{ height }} />
			</TableRow>
		) : null

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<p aria-live="polite" className="sr-only">
				{columnMessage}
			</p>
			<div className="flex shrink-0 items-center justify-between gap-2 border-b bg-card px-3 py-1.5">
				<p className="min-w-0 truncate text-xs text-muted-foreground">
					Перетягніть ручку заголовка, щоб змінити порядок. Потягніть край, щоб змінити ширину.
				</p>
				<FleetColumnSettings columns={table.getVisibleLeafColumns()} onMove={moveColumn} onReset={resetColumns} />
			</div>
			<div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto">
				<div style={{ minWidth: Math.max(gridMinWidth(metrics), table.getTotalSize()) }}>
					<Table
						role="treegrid"
						aria-label="Дерево рекламних кабінетів"
						containerClassName="overflow-hidden"
						className="table-fixed"
						style={{ minWidth: Math.max(gridMinWidth(metrics), table.getTotalSize()) }}
					>
						<colgroup>
							{table.getVisibleLeafColumns().map(column => (
								<col key={column.id} style={{ width: column.getSize() }} />
							))}
						</colgroup>
						<TableHeader className="sticky top-0 z-10 bg-card">
							{table.getHeaderGroups().map(headerGroup => (
								<TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
									{headerGroup.headers.map(header => {
										const sortKey = columnSort(header.column.id)
										const label = columnLabel(header.column.id)
										return (
											<TableHead
												key={header.id}
												style={{ width: header.getSize() }}
												onDragOver={event => {
													event.preventDefault()
													if (draggedColumnId !== header.column.id) setDropTargetId(header.column.id)
												}}
												onDrop={event => {
													event.preventDefault()
													if (draggedColumnId) {
														onColumnOrderChange(current =>
															reorderColumnIds(current, draggedColumnId, header.column.id),
														)
														setColumnMessage(
															`Стовпець «${columnLabel(draggedColumnId)}» переміщено до «${label}».`,
														)
													}
													setDraggedColumnId(null)
													setDropTargetId(null)
												}}
												className={`relative ${columnClass(header.column.id)} ${dropTargetId === header.column.id ? 'border-r-2 border-primary bg-primary/10' : ''}`}
												aria-sort={
													sortKey === null || sort !== sortKey
														? 'none'
														: direction === 'asc'
															? 'ascending'
															: 'descending'
												}
											>
												{header.isPlaceholder ? null : (
													<div className="flex min-w-0 items-center gap-0.5">
														<ColumnDragHandle
															label={label}
															onDragStart={event => {
																event.dataTransfer.effectAllowed = 'move'
																event.dataTransfer.setData('text/plain', header.column.id)
																setDraggedColumnId(header.column.id)
															}}
															onDragEnd={() => {
																setDraggedColumnId(null)
																setDropTargetId(null)
															}}
														/>
														<div className="min-w-0 flex-1">
															{flexRender(header.column.columnDef.header, header.getContext())}
														</div>
													</div>
												)}
												<ColumnResizeHandle
													header={header}
													label={label}
													size={header.getSize()}
													onResizeByKeyboard={resizeByKeyboard}
												/>
											</TableHead>
										)
									})}
								</TableRow>
							))}
						</TableHeader>
						<TableBody>
							{spacer(firstItem?.start ?? 0, 'top-spacer')}
							{virtualItems.map(item => {
								const displayRow = displayRows[item.index]!
								if (displayRow.kind === 'detail') {
									return (
										<TableRow
											key={`${displayRow.row.id}-detail`}
											ref={virtualizer.measureElement}
											data-index={item.index}
											className="border-b hover:bg-transparent"
										>
											<TableCell colSpan={columns.length} className="p-0">
												<div className="border-t px-2 py-1">{displayRow.content}</div>
											</TableCell>
										</TableRow>
									)
								}
								const row = displayRow.row
								const node = row.original.node
								const isExpandable = node.type !== 'ad'
								const isExpanded =
									node.type === 'ad'
										? renderExpandedRow(row.original) !== null
										: expanded.has(fleetBoardParentKey(node.type, node.id))
								return (
									<TableRow
										key={row.id}
										ref={virtualizer.measureElement}
										data-index={item.index}
										aria-level={row.original.level + 1}
										aria-expanded={isExpandable ? isExpanded : undefined}
										tabIndex={0}
										className="cursor-pointer"
										onClick={() => onToggle(node)}
										onKeyDown={event => {
											if (
												event.target !== event.currentTarget ||
												(event.key !== 'Enter' && event.key !== ' ')
											)
												return
											event.preventDefault()
											onToggle(node)
										}}
									>
										{row.getVisibleCells().map(cell => (
											<TableCell
												key={cell.id}
												style={{ width: cell.column.getSize() }}
												className={columnClass(cell.column.id)}
											>
												{flexRender(cell.column.columnDef.cell, cell.getContext())}
											</TableCell>
										))}
									</TableRow>
								)
							})}
							{spacer(
								lastItem ? virtualizer.getTotalSize() - lastItem.end : virtualizer.getTotalSize(),
								'bottom-spacer',
							)}
						</TableBody>
					</Table>
				</div>
			</div>
		</div>
	)
}

export function ControlRoom({
	accounts,
	search,
	setSearch,
	columnLayoutKey,
	nodeIndex,
	expanded,
	creativeAdId,
	onToggle,
	onRefresh,
}: ViewProps) {
	const selected = accounts.find(account => account.id === search.account) ?? accounts[0]!
	const railItems = accounts
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
							const account = railItems[item.index]!
							const isSelected = account.id === selected.id
							return (
								// A real <button> can't nest the sync-health icon's own <button> trigger, so this
								// is a div with button semantics instead (matches the row-click pattern used
								// elsewhere in this file for the same reason).
								<div
									key={account.id}
									role="button"
									tabIndex={0}
									ref={rail.measureElement}
									data-index={item.index}
									aria-current={isSelected ? 'true' : undefined}
									onClick={() => setSearch({ account: account.id })}
									onKeyDown={event => {
										if (event.key !== 'Enter' && event.key !== ' ') return
										event.preventDefault()
										setSearch({ account: account.id })
									}}
									className={`absolute flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm ${
										isSelected
											? 'border-l-2 border-primary bg-background font-medium shadow-sm'
											: 'border-l-2 border-transparent hover:bg-background/60'
									}`}
									style={{ transform: `translateY(${item.start}px)` }}
								>
									{/* The name leads and must not be the element that truncates away. */}
									<span className="w-full truncate">{account.name}</span>
									<span className="flex items-center gap-1.5">
										<HealthLabel health={account.health} />
										<AccountSyncHealthIndicator account={account} onRefresh={onRefresh} />
									</span>
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
								</div>
							)
						})}
					</div>
				</div>
			</aside>
			<div className="flex min-h-0 min-w-0 flex-col p-3">
				<p className="mb-2 shrink-0 text-xs text-muted-foreground">{selected.clientName}</p>
				<TreeView
					accounts={[selected]}
					search={search}
					setSearch={setSearch}
					columnLayoutKey={columnLayoutKey}
					nodeIndex={nodeIndex}
					expanded={expanded}
					creativeAdId={creativeAdId}
					onToggle={onToggle}
					onRefresh={onRefresh}
				/>
			</div>
		</section>
	)
}

export function SignalsView({ accounts, search, nodeIndex, expanded, creativeAdId, onToggle, onRefresh }: ViewProps) {
	return (
		<div className="grid min-h-0 min-w-0 flex-1 content-start items-start gap-3 overflow-y-auto xl:grid-cols-2">
			{(Object.keys(laneLabels) as Array<keyof typeof laneLabels>).map(lane => (
				<SignalLane
					key={lane}
					lane={lane}
					items={accounts.filter(account => account.signalsLane === lane)}
					search={search}
					nodeIndex={nodeIndex}
					expanded={expanded}
					creativeAdId={creativeAdId}
					onToggle={onToggle}
					onRefresh={onRefresh}
				/>
			))}
		</div>
	)
}

function SignalLane({
	lane,
	items,
	search,
	nodeIndex,
	expanded,
	creativeAdId,
	onToggle,
	onRefresh,
}: {
	lane: keyof typeof laneLabels
	items: Account[]
	search: FleetBoardSearch
	nodeIndex: NodeIndex
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
	onRefresh: () => void
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
					{items.map(account => {
						const isOpen = expanded.has(fleetBoardParentKey('account', account.id))
						return (
							<article key={account.id} className="rounded-lg border bg-background p-2">
								{/* A div with button semantics, not a real <button>: the sync-health icon
									below renders its own <button> trigger and cannot nest inside one. */}
								<div
									role="button"
									tabIndex={0}
									className="flex w-full cursor-pointer items-start justify-between gap-3 text-left"
									onClick={() => onToggle(account)}
									onKeyDown={event => {
										if (event.key !== 'Enter' && event.key !== ' ') return
										event.preventDefault()
										onToggle(account)
									}}
								>
									<span className="min-w-0">
										<span className="block truncate text-sm font-medium">{account.name}</span>
										<span className="block truncate text-xs text-muted-foreground">{account.clientName}</span>
									</span>
									<span className="flex shrink-0 items-center gap-1.5">
										<HealthLabel health={account.health} muted={account.signalsLane === lane} />
										<AccountSyncHealthIndicator account={account} onRefresh={onRefresh} />
									</span>
								</div>
								<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
									<MetaAdsManagerLink accountId={account.id} />
								</div>
								<KpiStrip kpis={account.kpis} metrics={search.metrics} currency={account.currency} />
								{isOpen ? (
									<div className="mt-2 border-t pt-1">
										{flattenAccount(account, 0, search, nodeIndex, expanded).map(row => (
											<NodeRow
												key={`${row.node.type}:${row.node.id}`}
												row={row}
												metrics={search.metrics}
												expanded={expanded}
												creativeAdId={creativeAdId}
												onToggle={onToggle}
												onRefresh={onRefresh}
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

function NodeRow({
	row,
	metrics,
	expanded,
	creativeAdId,
	onToggle,
	onRefresh,
}: {
	row: TreeRow
	metrics: FleetBoardMetricKey[]
	expanded: Set<string>
	creativeAdId: string | null
	onToggle: (node: Node) => void
	onRefresh: () => void
}) {
	const { node } = row
	const isExpandable = node.type !== 'ad'
	const isExpanded =
		node.type === 'ad' ? creativeAdId === node.id : expanded.has(fleetBoardParentKey(node.type, node.id))
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
				<NodeNameCell row={row} onToggle={onToggle} isExpanded={isExpanded} />
				<NodeHealthCell node={node} onRefresh={onRefresh} />
				<NodeStateCell node={node} />
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

function NodeNameCell({
	row,
	onToggle,
	isExpanded,
}: {
	row: TreeRow
	onToggle: (node: Node) => void
	isExpanded: boolean
}) {
	const { node } = row
	const isAccount = node.type === 'account'
	return (
		<span className="flex min-w-0 flex-col justify-center" style={{ paddingInlineStart: row.level * 14 }}>
			<span className="flex min-w-0 items-center gap-1">
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
						<AdThumbnail creativeId={node.creativeId} hasVideo={node.creativeHasVideo} />
					)}
					<span className={isAccount ? 'truncate font-semibold' : 'truncate'}>{node.name}</span>
				</button>
				{isAccount ? <MetaAdsManagerLink accountId={node.id} /> : null}
			</span>
			{isAccount ? (
				<span className="flex min-w-0 items-center gap-1 pl-[18px]">
					<span className="truncate text-xs text-muted-foreground/80">{node.id}</span>
					<CopyIdButton id={node.id} />
				</span>
			) : null}
		</span>
	)
}

function NodeHealthCell({ node, onRefresh }: { node: Node; onRefresh: () => void }) {
	if (!('health' in node)) return <span />
	return (
		<span className="flex min-w-0 items-center gap-1.5">
			<HealthLabel health={node.health} />
			<AccountSyncHealthIndicator account={node} onRefresh={onRefresh} />
		</span>
	)
}

function NodeStateCell({ node }: { node: Node }) {
	return 'connectionStatus' in node ? (
		<RunningCell running={node.kpis.running} />
	) : (
		<span className="truncate text-xs text-muted-foreground">{effectiveStatusText(node.effectiveStatus)}</span>
	)
}

function AdThumbnail({ creativeId, hasVideo }: { creativeId: string | null; hasVideo: boolean }) {
	const [failed, setFailed] = useState(false)
	const FallbackIcon = hasVideo ? Video : ImageIcon
	if (!creativeId || failed) {
		return <FallbackIcon size={14} className="mr-2 shrink-0 text-muted-foreground" aria-hidden />
	}
	return (
		<span className="relative my-0.5 mr-2 inline-flex h-8 w-8 shrink-0">
			<img
				src={mediaUrl(creativeId, 'thumb')}
				alt=""
				className="h-8 w-8 rounded object-cover"
				onError={() => setFailed(true)}
			/>
			{hasVideo ? (
				<>
					<Video
						size={12}
						className="absolute right-0 bottom-0 rounded-full bg-black/70 p-[1px] text-white"
						aria-hidden="true"
					/>
					<span className="sr-only">Відеооголошення</span>
				</>
			) : null}
		</span>
	)
}

function CreativeDetail({ adId, onClose }: { adId: string; onClose: () => void }) {
	const [selectedAssetKey, setSelectedAssetKey] = useState<string | null>(null)
	const creative = useQuery(fleetBoardQueries.creative(adId))
	const needsPreview = (creative.data?.assets ?? []).some(asset => asset.kind === 'video' && asset.mediaKey === null)
	const preview = useQuery(fleetBoardQueries.adPreview(adId, needsPreview))
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
	const previewAsset = preview.data?.preview
		? [{ key: 'meta-preview', kind: 'preview' as const, label: 'Перегляд від Meta', ...preview.data.preview }]
		: []
	const previewPending = needsPreview && preview.isPending
	const assets = [...mediaAssets, ...previewAsset]
	const nonMediaAssets = data.assets.filter(asset => !asset.mediaKey && asset.kind !== 'video')
	const selectedAsset = assets.find(asset => asset.key === selectedAssetKey) ?? assets[0]
	return (
		<Lightbox
			open
			onOpenChange={nextOpen => {
				if (!nextOpen) onClose()
			}}
			assets={assets}
			selectedAssetKey={selectedAsset?.key ?? null}
			onSelectedAssetChange={setSelectedAssetKey}
			mediaUnavailable={data.mediaUnavailable}
			previewPending={previewPending}
			mediaUrl={mediaKey => mediaUrl(data.id, mediaKey)}
			metadata={{
				title: creativeTitle(data),
				body: data.body,
				description: data.description,
				callToAction: data.callToAction ? callToActionText(data.callToAction) : null,
				destination: data.destination,
			}}
			hasMultipleAssets={data.assets.length > 1}
		>
			{nonMediaAssets.length > 0 ? (
				<div className="flex flex-wrap gap-2">
					{nonMediaAssets.map(asset => (
						<div key={asset.key} className="w-28 overflow-hidden rounded-md border bg-background">
							<div className="flex aspect-square items-center justify-center bg-muted p-2 text-center text-xs text-muted-foreground">
								{asset.kind === 'image' || asset.kind === 'video' ? 'Медіафайл' : (asset.value ?? asset.label)}
							</div>
							<p className="truncate px-2 py-1 text-xs">
								{asset.label}
								{asset.value ? `: ${asset.value}` : ''}
							</p>
						</div>
					))}
				</div>
			) : null}
			{data.existingPostId ? (
				<p className="text-xs text-muted-foreground/70">Ідентифікатор допису Meta: {data.existingPostId}</p>
			) : null}
		</Lightbox>
	)
}

function CopyIdButton({ id }: { id: string }) {
	const [copied, setCopied] = useState(false)
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={event => {
							event.stopPropagation()
							navigator.clipboard.writeText(id)
							setCopied(true)
							setTimeout(() => setCopied(false), 1500)
						}}
						aria-label="Скопіювати ID кабінету"
						className="inline-flex shrink-0 items-center text-muted-foreground hover:text-primary"
					>
						{copied ? <Check size={12} /> : <Copy size={12} />}
					</button>
				</TooltipTrigger>
				<TooltipContent>{copied ? 'Скопійовано' : 'Копіювати ID'}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
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

// Issue #58: synchronization health is a second, independent icon beside Health Color/Reason
// above — it answers whether Adomata's own copy of the data is fresh, not whether Meta reports
// the Ad Account itself as healthy (ADR 0018 vs ADR 0032).
function SyncHealthGlyph({ severity }: { severity: SyncHealth['severity'] }) {
	const Icon = severity === 'red' ? CircleAlert : TriangleAlert
	return <Icon size={16} className={syncSeverityIconColorClass(severity)} aria-hidden />
}

// A controlled-but-hands-off popover: base-ui's PopoverTrigger already opens on hover, click, and
// tap (with `stickIfOpen` so a click after a hover doesn't immediately toggle it shut). Keyboard
// focus is the one interaction it doesn't cover on its own, so a focus handler opens it the same
// way a real click would, while an outside click, Escape, or a second click still closes it
// through base-ui's own dismissal logic — nothing here fights that.
function SyncHealthTrigger({
	label,
	triggerContent,
	children,
}: {
	label: string
	triggerContent: ReactNode
	children: ReactNode
}) {
	const triggerRef = useRef<HTMLButtonElement>(null)
	const openRef = useRef(false)
	return (
		<Popover
			onOpenChange={next => {
				openRef.current = next
			}}
		>
			<PopoverTrigger
				ref={triggerRef}
				openOnHover
				aria-label={label}
				onClick={event => event.stopPropagation()}
				onFocus={() => {
					if (!openRef.current) triggerRef.current?.click()
				}}
				className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
			>
				{triggerContent}
			</PopoverTrigger>
			<PopoverContent
				className="flex w-80 flex-col gap-3 text-sm"
				align="start"
				onClick={event => event.stopPropagation()}
			>
				{children}
			</PopoverContent>
		</Popover>
	)
}

function SyncHealthFindingDetail({ finding, onRefresh }: { finding: SyncFinding; onRefresh: () => void }) {
	const { data: me } = useMe()
	const isOwner = me?.activeOrgMember?.role === 'owner'
	const showForceRefresh = syncFindingShowsForceRefresh(finding)
	const showReconnect = syncFindingShowsReconnect(finding) && isOwner
	return (
		<div className="flex flex-col gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
			<p className="flex items-center gap-1.5 text-xs font-semibold">
				<SyncHealthGlyph severity={finding.severity} />
				{syncSliceText(finding.slice)}
			</p>
			<p className="text-xs text-muted-foreground">{syncFindingAvailabilityText(finding)}</p>
			<p className="text-xs text-muted-foreground">{syncFindingCauseText(finding)}</p>
			<p className="text-xs text-muted-foreground">{syncFindingActionText(finding)}</p>
			{showForceRefresh || showReconnect ? (
				<div className="flex flex-wrap items-center gap-2 pt-1">
					{showForceRefresh ? (
						<Button type="button" size="xs" variant="outline" onClick={onRefresh}>
							Оновити дані
						</Button>
					) : null}
					{showReconnect ? (
						<Button type="button" size="xs" variant="outline" asChild>
							<Link to="/organization/settings">Перепідключити Meta</Link>
						</Button>
					) : null}
				</div>
			) : null}
			{finding.diagnosticReference ? (
				<p className="text-[11px] text-muted-foreground/70">
					Діагностичний код: {finding.diagnosticReference}
					{me?.isSuperadmin && finding.metaErrorCode !== null ? ` · Код Meta: ${finding.metaErrorCode}` : ''}
				</p>
			) : null}
		</div>
	)
}

function AccountSyncHealthIndicator({ account, onRefresh }: { account: Account; onRefresh: () => void }) {
	const syncHealth = account.syncHealth
	if (!syncHealth) return null
	const label = `${syncHealth.severity === 'red' ? 'Потрібна дія' : 'Синхронізація застаріла'}: ${account.name}`
	return (
		<SyncHealthTrigger label={label} triggerContent={<SyncHealthGlyph severity={syncHealth.severity} />}>
			<p className="text-sm font-semibold">{account.name}</p>
			{syncHealth.findings.map(finding => (
				<SyncHealthFindingDetail key={finding.slice} finding={finding} onRefresh={onRefresh} />
			))}
		</SyncHealthTrigger>
	)
}

function FleetSyncHealthAggregate({
	syncHealth,
	accounts,
	onRefresh,
}: {
	syncHealth: FleetBoardRoot['header']['syncHealth'] | undefined
	accounts: Account[]
	onRefresh: () => void
}) {
	if (!syncHealth) return null
	const affected = accounts.filter(account => account.syncHealth !== null)
	return (
		<SyncHealthTrigger
			label={`Потребують уваги: ${syncHealth.affectedAccountCount}`}
			triggerContent={
				<>
					<SyncHealthGlyph severity={syncHealth.severity} />
					<span className="text-xs font-medium tabular-nums">{syncHealth.affectedAccountCount}</span>
				</>
			}
		>
			<p className="text-sm font-semibold">Кабінети, що потребують уваги ({syncHealth.affectedAccountCount})</p>
			<ul className="flex flex-col gap-1">
				{affected.map(account => (
					<li key={account.id} className="flex items-center gap-1.5 text-xs">
						<SyncHealthGlyph severity={account.syncHealth!.severity} />
						<span className="truncate">{account.name}</span>
					</li>
				))}
			</ul>
			<Button type="button" size="xs" variant="outline" className="self-start" onClick={onRefresh}>
				Оновити дані
			</Button>
		</SyncHealthTrigger>
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
	kpis: Node['kpis']
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
	kpis: Node['kpis']
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
