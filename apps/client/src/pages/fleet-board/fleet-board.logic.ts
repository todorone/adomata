import type { FleetBoardHierarchyResponse } from '@adomata/api/client'

import type { FleetBoardParent, FleetBoardRoot } from '@/data/fleet-board'
import type { FleetBoardMetricKey, FleetBoardSearch } from '@/data/fleet-board-search'

export type Account = FleetBoardRoot['accounts'][number]
export type Client = FleetBoardRoot['clients'][number]
export type HierarchyNode = FleetBoardHierarchyResponse['nodes'][number]
export type Node = Account | HierarchyNode
export type TreeRow = { node: Node; level: number; currency: string | null; mergedClient?: Client }
export type BoardRow = ({ kind: 'client'; client: Client } | ({ kind: 'node' } & TreeRow)) & { key: string }
export type SortKey = FleetBoardSearch['sort']

export const depthValues = ['account', 'campaign', 'adset', 'ad'] as const
export const noData = '—'

export function flattenRows(
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

export function flattenAccount(
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

export function parentsNeededForDepth(
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

export function mergeChildren(
	current: Record<string, HierarchyNode[]>,
	requested: FleetBoardParent[],
	nodes: HierarchyNode[],
) {
	const next = { ...current }

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

export function parentKey(type: FleetBoardParent['type'] | 'account', id: string) {
	return `${type}:${id}`
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
				client_attention: 'Потребують уваги',
				client_postpay: 'Є післяплатні',
				client_active: 'Активні кабінети',
				client_awaiting_data: 'Очікуються дані',
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

export function syncNote(accounts: Account[]) {
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
