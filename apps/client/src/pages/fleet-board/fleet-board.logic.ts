import { fleetBoardParentKey, type FleetBoardNodeIndex, type FleetBoardRoot } from '@/data/fleet-board'
import type { FleetBoardMetricKey, FleetBoardSearch } from '@/data/fleet-board-search'

export type Account = FleetBoardRoot['accounts'][number]
export type Client = FleetBoardRoot['clients'][number]
export type FleetBoardNode = FleetBoardRoot['nodes'][number]
export type Node = Account | FleetBoardNode
export type NodeIndex = FleetBoardNodeIndex
export type TreeRow = { node: Node; level: number; currency: string | null }
export type BoardRow = TreeRow & { key: string }
export type SortKey = FleetBoardSearch['sort']

export const depthValues = ['account', 'campaign', 'adset', 'ad'] as const
export const noData = '—'

export function flattenRows(
	accounts: Account[],
	search: FleetBoardSearch,
	nodeIndex: NodeIndex,
	expanded: Set<string>,
): BoardRow[] {
	return accounts.flatMap(account =>
		flattenAccount(account, 0, search, nodeIndex, expanded).map(row => ({ ...row, key: rowKey(row) })),
	)
}

export function flattenAccount(
	account: Account,
	baseLevel: number,
	search: FleetBoardSearch,
	nodeIndex: NodeIndex,
	expanded: Set<string>,
) {
	return flattenNode(account, baseLevel, account.currency, search, nodeIndex, expanded)
}

function visibleChildren(node: Node, search: FleetBoardSearch, nodeIndex: NodeIndex) {
	return childrenOf(node, nodeIndex).filter(child => !search.hidePaused || child.kpis.running)
}

function childrenOf(node: Node, nodeIndex: NodeIndex) {
	if (node.type === 'ad') return []
	return nodeIndex[fleetBoardParentKey(node.type, node.id)] ?? []
}

export function expandSingleChildChain(
	node: Node,
	search: FleetBoardSearch,
	nodeIndex: NodeIndex,
	expanded: Set<string>,
) {
	const next = new Set(expanded)
	if (node.type === 'ad') return next

	next.add(fleetBoardParentKey(node.type, node.id))
	let current = node
	while (current.type !== 'ad') {
		const children = childrenOf(current, nodeIndex)
		if (children.length !== 1) break

		const child = children[0]!
		if (child.type === 'ad') break
		if (childrenOf(child, nodeIndex).length === 0) break
		next.add(fleetBoardParentKey(child.type, child.id))
		current = child
	}

	return next
}

function flattenNode(
	node: Node,
	level: number,
	currency: string | null,
	search: FleetBoardSearch,
	nodeIndex: NodeIndex,
	expanded: Set<string>,
): TreeRow[] {
	const rows: TreeRow[] = [{ node, level, currency }]
	if (node.type === 'ad') return rows
	const typeDepth = depthValues.indexOf(node.type)
	if (depthValues.indexOf(search.depth) <= typeDepth && !expanded.has(fleetBoardParentKey(node.type, node.id)))
		return rows
	for (const child of visibleChildren(node, search, nodeIndex)) {
		// A rendering toggle, not a filter: hiding a non-Running interior row changes nothing
		// about any parent's numbers, which are rollups computed server-side.
		rows.push(...flattenNode(child, level + 1, currency, search, nodeIndex, expanded))
	}
	return rows
}

function rowKey(row: TreeRow) {
	return `${row.node.type}:${row.node.id}:${row.level}`
}

const columnWidths = { name: [180, 340], health: [132, 190], running: [84, 110], owed: [96, 130] } as const
const metricColumnMin = 88
const columnGap = 8
const rowPaddingX = 8

export function gridTemplate(metrics: FleetBoardMetricKey[]) {
	const fixed = Object.values(columnWidths)
		.map(([min, max]) => `minmax(${min}px, ${max}px)`)
		.join(' ')
	return `${fixed} repeat(${metrics.length}, minmax(${metricColumnMin}px, 1fr))`
}

export function gridMinWidth(metrics: FleetBoardMetricKey[]) {
	const columns = Object.values(columnWidths).length + metrics.length
	const floors = Object.values(columnWidths).reduce((total, [min]) => total + min, metrics.length * metricColumnMin)
	return floors + (columns - 1) * columnGap + rowPaddingX * 2
}

export function nextMetrics(search: FleetBoardSearch, metric: FleetBoardMetricKey) {
	const metrics = search.metrics.includes(metric)
		? search.metrics.filter(value => value !== metric)
		: [...search.metrics, metric]
	return metrics.length ? metrics : search.metrics
}

export function healthColorClass(color: string) {
	return color === 'red'
		? 'bg-red-500'
		: color === 'yellow'
			? 'bg-amber-500'
			: color === 'green'
				? 'bg-emerald-500'
				: 'bg-slate-400'
}

export function healthText(code: string) {
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
			} as Record<string, string>
		)[code] ?? 'Стан Meta невідомий'
	)
}

export function effectiveStatusText(status: string) {
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

export function callToActionText(callToAction: string) {
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

export function formatKpi(metric: FleetBoardMetricKey, value: string | number | null, currency: string | null) {
	if (value === null) return noData
	if (metric === 'spend' || metric === 'cpa') return formatMoney(String(value), currency)
	if (metric === 'impressions' || metric === 'clicks') return Number(value).toLocaleString('uk-UA')
	if (metric === 'results') return Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 2 })
	if (metric === 'ctr') return `${(Number(value) * 100).toLocaleString('uk-UA', { maximumFractionDigits: 2 })}%`
	if (metric === 'roas')
		return Number(value) === 0 ? noData : `${Number(value).toLocaleString('uk-UA', { maximumFractionDigits: 2 })}×`
	return String(value)
}

export function formatMoney(value: string | null, currency: string | null) {
	if (value === null || !currency) return noData
	return new Intl.NumberFormat('uk-UA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
		Number(value),
	)
}

export function creativeTitle(creative: { headline: string | null; body: string | null }) {
	return (
		creative.headline?.trim() ||
		creative.body
			?.split('\n')
			.map(line => line.trim())
			.find(line => line.length > 0) ||
		'Креатив'
	)
}

export function metaAdsManagerUrl(accountId: string) {
	const actId = accountId.replace(/^act_/, '')
	return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(actId)}`
}

export function syncNote(account: Account) {
	const tiers = [account.freshness.accountTier, account.freshness.insightsTier]
	const failed = tiers.filter(tier => tier.failed)
	if (failed.length > 0) return 'Помилка синхронізації Meta'
	const neverSynced = tiers.filter(tier => tier.refreshedAt === null)
	if (neverSynced.length > 0) return 'Ще не синхронізовано'
	const stale = tiers.filter(tier => tier.stale)
	if (stale.length > 0) return 'Дані застаріли'
	return null
}

export function freshnessText(value: string | null | undefined, stale: boolean, neverSynced: number) {
	const pending = neverSynced > 0 ? ` · без синхр.: ${neverSynced}` : ''
	if (!value) return `ще не синхронізовано${neverSynced > 1 ? ` (${neverSynced})` : ''}`
	const time = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
	return `${stale ? `застаріло, ${time}` : time}${pending}`
}

export function mediaUrl(creativeId: string, key: string) {
	const base = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'
	return `${base}/fleet-board/creatives/${encodeURIComponent(creativeId)}/media/${encodeURIComponent(key)}`
}
