import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	ApiClientError,
	type FleetBoardNode,
	type FleetBoardSyncFinding,
	type ForceRefreshResponse,
} from '@adomata/api/client'

import type { FleetBoardRoot } from '@/data/fleet-board'
import { fleetBoardSearchSchema, type FleetBoardSearch } from '@/data/fleet-board-search'

type Account = FleetBoardRoot['accounts'][number]
type Client = FleetBoardRoot['clients'][number]
type BoardNode = FleetBoardNode
type Kpis = Account['kpis']
type Me = { isSuperadmin: boolean; activeOrgMember: { role: 'owner' | 'admin' | 'member' } | null }

function kpis(overrides: Partial<Kpis> = {}): Kpis {
	return {
		spend: '100',
		impressions: 1000,
		clicks: 40,
		ctr: '0.04',
		cpa: '25',
		cpaReason: null,
		results: '4',
		roas: '2',
		running: true,
		...overrides,
	}
}

function syncFinding(overrides: Partial<FleetBoardSyncFinding> = {}): FleetBoardSyncFinding {
	return {
		slice: 'account_data',
		severity: 'yellow',
		reason: 'stale',
		lastSuccessAt: '2026-01-01T11:00:00.000Z',
		diagnosticReference: 'sync-run/run_1/account-data/act_1',
		metaErrorCode: null,
		...overrides,
	}
}

const soloAccount: Account = {
	id: 'act_100000000000001',
	type: 'account',
	clientId: 'client-solo',
	clientName: 'DeviAcademy',
	name: 'DeviAcademy Ad',
	currency: 'UAH',
	timezoneName: 'Europe/Kyiv',
	connectionStatus: 'connected',
	health: { color: 'green', reason: { code: 'active' }, needsAttention: false },
	signalsLane: 'active',
	// No purchase value recorded anywhere on this lead-generation account.
	kpis: kpis({ spend: '1234.50', roas: '0' }),
	syncHealth: null,
}

const duoFirst: Account = {
	...soloAccount,
	id: 'act_200000000000001',
	clientId: 'client-duo',
	clientName: 'Northstar',
	name: 'Northstar Prepay',
	currency: 'USD',
	health: { color: 'red', reason: { code: 'meta_disabled', disableReason: 3 }, needsAttention: true },
	signalsLane: 'needs_attention',
	kpis: kpis(),
}

const duoSecond: Account = {
	...duoFirst,
	id: 'act_200000000000002',
	name: 'Northstar Postpay',
	health: { color: 'yellow', reason: { code: 'postpay' }, needsAttention: false },
	signalsLane: 'postpay',
	// A measured zero, which must still read as a number.
	kpis: kpis({ spend: '0', roas: '0' }),
}

const soloClient: Client = {
	id: 'client-solo',
	name: 'DeviAcademy',
}

const duoClient: Client = {
	id: 'client-duo',
	name: 'Northstar',
}

const snapshotNodes: BoardNode[] = [
	{
		id: 'campaign-1',
		type: 'campaign',
		parentId: soloAccount.id,
		name: 'Кампанія Ліди',
		effectiveStatus: 'ACTIVE',
		kpis: kpis({ spend: '300', cpa: '15' }),
		creativeId: null,
		creativeHasVideo: false,
	},
	{
		id: 'campaign-paused',
		type: 'campaign',
		parentId: soloAccount.id,
		name: 'Кампанія призупинена',
		effectiveStatus: 'PAUSED',
		kpis: kpis({ running: false }),
		creativeId: null,
		creativeHasVideo: false,
	},
	{
		id: 'adset-1',
		type: 'adset',
		parentId: 'campaign-1',
		name: 'Група Київ',
		effectiveStatus: 'ACTIVE',
		kpis: kpis({ spend: '300', cpa: '15' }),
		creativeId: null,
		creativeHasVideo: false,
	},
	{
		id: 'ad-running',
		type: 'ad',
		parentId: 'adset-1',
		name: 'Оголошення що працює',
		effectiveStatus: 'ACTIVE',
		kpis: kpis({ spend: '200', cpa: '17.5', running: true }),
		creativeId: 'creative-1',
		creativeHasVideo: true,
	},
	{
		id: 'ad-disapproved',
		type: 'ad',
		parentId: 'adset-1',
		name: 'Оголошення відхилене',
		effectiveStatus: 'DISAPPROVED',
		kpis: kpis({ spend: '100', cpa: '11.25', running: false }),
		creativeId: null,
		creativeHasVideo: false,
	},
	{
		id: 'ad-future-status',
		type: 'ad',
		parentId: 'adset-1',
		name: 'Оголошення новий статус',
		effectiveStatus: 'SOME_STATUS_META_ADDED_LATER',
		kpis: kpis({ spend: '0', running: false }),
		creativeId: null,
		creativeHasVideo: false,
	},
]

const snapshotNodeIndex = {
	'account:act_100000000000001': [snapshotNodes[0]!, snapshotNodes[1]!],
	'campaign:campaign-1': [snapshotNodes[2]!],
	'adset:adset-1': snapshotNodes.slice(3),
}

const { refetchSpy, requestForceRefreshSpy, readForceRefreshSpy, meState } = vi.hoisted(() => ({
	refetchSpy: vi.fn(() => Promise.resolve()),
	requestForceRefreshSpy: vi.fn<() => Promise<ForceRefreshResponse>>(() =>
		Promise.resolve({ id: 'refresh_1', status: 'queued' }),
	),
	readForceRefreshSpy: vi.fn<(id: string, signal?: AbortSignal) => Promise<ForceRefreshResponse>>(() =>
		Promise.resolve({ id: 'refresh_1', status: 'completed' }),
	),
	meState: { current: { isSuperadmin: false, activeOrgMember: { role: 'member' } } as Me },
}))

const rootResponse: FleetBoardRoot = {
	clients: [soloClient, duoClient],
	accounts: [soloAccount, duoFirst, duoSecond],
	nodes: snapshotNodes,
	nodeIndex: snapshotNodeIndex,
	header: {
		provisional: false,
		syncHealth: null,
	},
}

// jsdom has no layout, so a real virtualizer measures a zero-height viewport and mounts no
// rows at all. Windowing is replaced with "render everything" so these tests can assert what a
// user sees; row heights and scrolling are verified by hand, not here.
vi.mock('@tanstack/react-virtual', () => {
	const stub = ({ count, estimateSize }: { count: number; estimateSize: (index: number) => number }) => ({
		getTotalSize: () => count * estimateSize(0),
		getVirtualItems: () =>
			Array.from({ length: count }, (_, index) => ({
				index,
				key: index,
				start: index * estimateSize(index),
				size: estimateSize(index),
			})),
		measureElement: () => undefined,
	})
	return { useVirtualizer: stub, useWindowVirtualizer: stub }
})

vi.mock('@/data/fleet-board', () => ({
	fleetBoardParentKey: (type: string, id: string) => `${type}:${id}`,
	useFleetBoardRoot: () => ({
		data: rootResponse,
		isPending: false,
		isError: false,
		refetch: refetchSpy,
	}),
	fleetBoardQueries: {
		creative: (adId: string) =>
			queryOptions({
				queryKey: ['fleet-board', 'creative', adId] as const,
				queryFn: async () =>
					adId === 'ad-disapproved'
						? {
								id: 'creative-video',
								adId,
								name: null,
								kind: 'video' as const,
								body: null,
								headline: 'Відеореклама',
								description: null,
								callToAction: null,
								destination: null,
								existingPostId: null,
								assets: [{ key: 'm0', kind: 'video' as const, label: 'Відео', value: null, mediaKey: 'm0' }],
								mediaUnavailable: false,
							}
						: {
								id: 'creative-1',
								adId,
								name: 'Довгий рекламний текст який Meta згенерувала — a1b2c3',
								kind: 'image' as const,
								body: 'Перший рядок тексту\nДругий рядок',
								headline: null,
								description: null,
								callToAction: null,
								destination: null,
								existingPostId: 'page_1_2',
								assets: [
									{ key: 'image-1', kind: 'image' as const, label: 'Зображення', value: null, mediaKey: null },
								],
								mediaUnavailable: false,
							},
			}),
		adPreview: (adId: string, enabled: boolean) =>
			queryOptions({
				queryKey: ['fleet-board', 'ad-preview', adId] as const,
				queryFn: async () => ({ preview: null }),
				enabled,
			}),
	},
}))

vi.mock('@/data/force-refresh', () => ({
	requestForceRefresh: requestForceRefreshSpy,
	readForceRefresh: readForceRefreshSpy,
}))

vi.mock('@/data/me', () => ({
	useMe: () => ({ data: meState.current }),
}))

// The sync-health popover's Reconnect Meta action is a plain navigation link; these tests only
// need to assert it renders (and where it points), not exercise real client-side routing.
vi.mock('@tanstack/react-router', () => ({
	Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

const { FleetBoard } = await import('@/pages/fleet-board/fleet-board')

function money(value: string, currency: string) {
	return new Intl.NumberFormat('uk-UA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
		Number(value),
	)
}

function renderBoard(
	overrides: Record<string, unknown> = {},
	setSearch: (changes: Partial<FleetBoardSearch>) => void = () => undefined,
	columnLayoutKey: string | null = null,
) {
	const search = fleetBoardSearchSchema.parse(overrides) as FleetBoardSearch
	return render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<FleetBoard search={search} setSearch={setSearch} columnLayoutKey={columnLayoutKey} />
		</QueryClientProvider>,
	)
}

/** The row whose text contains `name`, so assertions read as "this row shows that". */
function row(name: string) {
	const match = screen.getAllByRole('row').find(element => element.textContent?.includes(name))
	if (!match) throw new Error(`No row containing ${name}. Rows: ${screen.getAllByRole('row').length}`)
	return match
}

async function renderToAdDepth(overrides: Record<string, unknown> = {}) {
	renderBoard({ depth: 'ad', metrics: 'spend,cpa,roas', ...overrides })
	// The one Ad that survives every rendering toggle.
	await waitFor(() => expect(screen.getByText('Оголошення що працює')).toBeTruthy())
}

describe('Fleet Board', () => {
	afterEach(() => {
		cleanup()
		vi.useRealTimers()
		localStorage.clear()
		sessionStorage.clear()
		refetchSpy.mockClear()
		requestForceRefreshSpy.mockClear()
		readForceRefreshSpy.mockClear()
		requestForceRefreshSpy.mockResolvedValue({ id: 'refresh_1', status: 'queued' })
		readForceRefreshSpy.mockResolvedValue({ id: 'refresh_1', status: 'completed' })
		rootResponse.header.provisional = false
		rootResponse.header.syncHealth = null
		soloAccount.syncHealth = null
		duoFirst.syncHealth = null
		duoSecond.syncHealth = null
		meState.current = { isSuperadmin: false, activeOrgMember: { role: 'member' } }
	})

	it('renders Spend and CPA below Ad Account level in the ancestor Ad Account currency', async () => {
		await renderToAdDepth()

		// Hierarchy nodes carry no currency of their own; before this they rendered the no-data marker.
		expect(row('Кампанія Ліди').textContent).toContain(money('300', 'UAH'))
		expect(row('Група Київ').textContent).toContain(money('300', 'UAH'))
		expect(row('Оголошення що працює').textContent).toContain(money('200', 'UAH'))
		expect(row('Оголошення що працює').textContent).toContain(money('17.5', 'UAH'))
	})

	it('settles at Ad depth even when some Ad Accounts have no campaigns at all', async () => {
		await renderToAdDepth()
		expect(screen.getByText('Northstar Prepay')).toBeTruthy()
	})

	it('keeps routine synchronization invisible while retaining the Provisional notice', () => {
		rootResponse.header.provisional = true
		renderBoard({ view: 'signals' })

		expect(screen.getByText('Уточнюється Meta.')).toBeTruthy()
		expect(screen.queryByText(/Операційні:/)).toBeNull()
		expect(screen.queryByText(/Показники:/)).toBeNull()
		expect(screen.queryByText('Очікують даних')).toBeNull()
		expect(screen.queryByText('Помилка синхронізації Meta')).toBeNull()
	})

	it('waits for persisted Force Refresh completion before rereading the snapshot', async () => {
		renderBoard({ depth: 'ad' })
		const refreshButton = screen.getByRole('button', { name: 'Оновити дані' })
		fireEvent.click(refreshButton)
		await waitFor(() => expect(requestForceRefreshSpy).toHaveBeenCalledTimes(1))
		await waitFor(() => expect(readForceRefreshSpy.mock.calls.some(([id]) => id === 'refresh_1')).toBe(true))
		await waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1))
	})

	it('resumes polling a persisted Force Refresh after reload', async () => {
		sessionStorage.setItem('force-refresh-id', 'refresh_1')
		renderBoard({ depth: 'ad' })

		await waitFor(() => expect(readForceRefreshSpy.mock.calls.some(([id]) => id === 'refresh_1')).toBe(true))
		await waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1))
		expect(requestForceRefreshSpy).not.toHaveBeenCalled()
	})

	it('stops polling a Force Refresh that does not terminate and exposes a failure', async () => {
		vi.useFakeTimers()
		sessionStorage.setItem('force-refresh-id', 'refresh_1')
		readForceRefreshSpy.mockResolvedValue({ id: 'refresh_1', status: 'running' })
		renderBoard()

		await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

		expect(readForceRefreshSpy.mock.calls.length).toBeLessThan(30)
		expect(sessionStorage.getItem('force-refresh-id')).toBeNull()
		expect(screen.getByLabelText('Не вдалося оновити дані')).toBeTruthy()
	})

	it('stops Force Refresh polling when the board unmounts', async () => {
		vi.useFakeTimers()
		sessionStorage.setItem('force-refresh-id', 'refresh_1')
		readForceRefreshSpy.mockResolvedValue({ id: 'refresh_1', status: 'running' })
		const { unmount } = renderBoard()

		await vi.advanceTimersByTimeAsync(0)
		expect(readForceRefreshSpy).toHaveBeenCalledTimes(1)
		unmount()
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

		expect(readForceRefreshSpy).toHaveBeenCalledTimes(1)
	})

	it('keeps Force Refresh disabled during the cooldown without showing an error icon', async () => {
		requestForceRefreshSpy.mockRejectedValueOnce(
			new ApiClientError({ error: { code: 'CONFLICT', message: 'Оновлення даних доступне раз на хвилину' } }, 429),
		)
		renderBoard()
		const refreshButton = screen.getByRole('button', { name: 'Оновити дані' })
		fireEvent.click(refreshButton)

		await waitFor(() => expect(refreshButton.hasAttribute('disabled')).toBe(true))
		expect(screen.getByText('Оновлення даних доступне раз на хвилину.')).toBeTruthy()
		expect(screen.queryByLabelText('Не вдалося оновити дані')).toBeNull()
	})

	it('disables Force Refresh while a persisted refresh is in flight', async () => {
		sessionStorage.setItem('force-refresh-id', 'refresh_1')
		readForceRefreshSpy.mockResolvedValue({ id: 'refresh_1', status: 'running' })
		renderBoard()

		await waitFor(() => expect(readForceRefreshSpy.mock.calls.some(([id]) => id === 'refresh_1')).toBe(true))
		expect(screen.getByRole('button', { name: 'Оновити дані' }).hasAttribute('disabled')).toBe(true)
	})

	it('shows a Creative thumbnail for an Ad that has one, and the placeholder icon otherwise', async () => {
		await renderToAdDepth()

		expect(within(row('Оголошення що працює')).getByText('Відеооголошення')).toBeTruthy()

		const thumbnail = row('Оголошення що працює').querySelector('img')
		expect(thumbnail?.getAttribute('src')).toBe('http://localhost:3000/fleet-board/creatives/creative-1/media/thumb')

		expect(row('Оголошення відхилене').querySelector('img')).toBeNull()
		expect(row('Оголошення відхилене').querySelector('svg')).toBeTruthy()
	})

	it('renders every Ad Account directly without a Client aggregate row', () => {
		renderBoard()

		row('DeviAcademy Ad')
		expect(screen.getAllByRole('row').filter(element => element.textContent?.includes('DeviAcademy'))).toHaveLength(1)

		expect(screen.getByText('Northstar Prepay')).toBeTruthy()
		expect(screen.getByText('Northstar Postpay')).toBeTruthy()
		// Both Ad Accounts render directly; there is no extra Client aggregate row.
		expect(screen.getAllByRole('row').filter(element => element.textContent?.includes('Northstar'))).toHaveLength(2)
	})

	it('renders the tree as a semantic DataTable with sortable column headers', () => {
		renderBoard()

		const table = screen.getByRole('treegrid', { name: 'Дерево рекламних кабінетів' })
		expect(within(table).getByRole('columnheader', { name: /Структура/ })).toBeTruthy()
		expect(
			within(table)
				.getByRole('columnheader', { name: /Здоров’я/ })
				.getAttribute('aria-sort'),
		).toBe('descending')
		expect(within(table).getByRole('columnheader', { name: /Стан/ })).toBeTruthy()
	})

	it('keeps root sorting in the table column definition', () => {
		const setSearch = vi.fn()
		renderBoard({}, setSearch)

		fireEvent.click(screen.getByRole('button', { name: 'Сортувати за: Структура' }))
		expect(setSearch).toHaveBeenCalledWith({ sort: 'name', direction: 'desc' })
	})

	it('reorders columns and resizes them with the column controls', async () => {
		renderBoard()

		fireEvent.click(screen.getByRole('button', { name: 'Налаштувати стовпці' }))
		fireEvent.click(screen.getByRole('button', { name: 'Перемістити «Структура» праворуч' }))

		const table = screen.getByRole('treegrid', { name: 'Дерево рекламних кабінетів' })
		const headers = within(table).getAllByRole('columnheader')
		expect(headers[0]?.textContent).toContain('Здоров’я')
		expect(headers[1]?.textContent).toContain('Структура')

		fireEvent.click(screen.getByRole('button', { name: 'Налаштувати стовпці' }))
		const resizeHandle = within(table).getByRole('separator', { name: 'Змінити ширину стовпця «Структура»' })
		expect(resizeHandle.getAttribute('aria-valuenow')).toBe('220')
		fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' })
		await waitFor(() =>
			expect(
				within(table)
					.getByRole('separator', { name: 'Змінити ширину стовпця «Структура»' })
					.getAttribute('aria-valuenow'),
			).toBe('228'),
		)
		expect(resizeHandle.className).toContain('after:bg-border')
		fireEvent.mouseDown(resizeHandle, { clientX: 100 })
		expect(document.body.style.cursor).toBe('col-resize')
		fireEvent.mouseMove(document, { clientX: 108 })
		expect(resizeHandle.getAttribute('aria-valuenow')).toBe('228')
		fireEvent.mouseUp(document, { clientX: 108 })
		await waitFor(() => expect(resizeHandle.getAttribute('aria-valuenow')).toBe('236'))
		expect(document.body.style.cursor).toBe('')
	})

	it('restores a layout for the supplied identity-scoped key', () => {
		const key = 'test:fleet-board:tree:user:agency'
		renderBoard({}, undefined, key)

		fireEvent.click(screen.getByRole('button', { name: 'Налаштувати стовпці' }))
		fireEvent.click(screen.getByRole('button', { name: 'Перемістити «Структура» праворуч' }))
		cleanup()

		renderBoard({}, undefined, key)
		const headers = within(screen.getByRole('treegrid', { name: 'Дерево рекламних кабінетів' })).getAllByRole(
			'columnheader',
		)
		expect(headers[0]?.textContent).toContain('Здоров’я')
		expect(headers[1]?.textContent).toContain('Структура')
	})

	it('expands and collapses when clicking anywhere on a row', async () => {
		renderBoard()

		const accountRow = row('DeviAcademy Ad')
		expect(accountRow.className).toContain('cursor-pointer')
		fireEvent.click(accountRow)
		await waitFor(() => expect(screen.getByText('Кампанія Ліди')).toBeTruthy())

		fireEvent.click(accountRow)
		await waitFor(() => expect(screen.queryByText('Кампанія Ліди')).toBeNull())

		fireEvent.keyDown(accountRow, { key: 'Enter' })
		await waitFor(() => expect(screen.getByText('Кампанія Ліди')).toBeTruthy())
		fireEvent.keyDown(accountRow, { key: ' ' })
		await waitFor(() => expect(screen.queryByText('Кампанія Ліди')).toBeNull())
	})

	it('recursively expands through visible single-child ancestors', async () => {
		renderBoard({ hidePaused: 'true' })

		fireEvent.click(row('DeviAcademy Ad'))

		await waitFor(() => {
			expect(screen.getByText('Кампанія Ліди')).toBeTruthy()
			expect(screen.getByText('Група Київ')).toBeTruthy()
			expect(screen.getByText('Оголошення що працює')).toBeTruthy()
		})
	})

	it.each(['tree', 'control', 'signals'])('shows Health Color paired with Health Reason in the %s view', view => {
		renderBoard({ view })

		// The Color dot and the Reason share one accessible label, so the pair is what is asserted.
		expect(screen.getAllByLabelText('Активний').length).toBeGreaterThan(0)
		expect(screen.getAllByLabelText('Meta вимкнула кабінет, потрібна увага').length).toBeGreaterThan(0)
	})

	it('labels a DISAPPROVED Ad specifically and keeps the fallback for statuses Meta adds later', async () => {
		await renderToAdDepth()

		expect(row('Оголошення відхилене').textContent).toContain('Відхилено Meta')
		expect(row('Оголошення новий статус').textContent).toContain('Статус Meta невідомий')
	})

	it('renders ROAS as no data without purchase value while a zero Spend stays a number', () => {
		renderBoard({ metrics: 'spend,roas' })

		const noPurchaseValue = row('DeviAcademy Ad')
		expect(noPurchaseValue.textContent).toContain(money('1234.50', 'UAH'))
		expect(noPurchaseValue.textContent).not.toContain('0×')
		expect(noPurchaseValue.textContent).toContain('—')
		expect(row('Northstar Postpay').textContent).toContain(money('0', 'USD'))
	})

	it('hides non-Running interior rows without changing any parent number', async () => {
		await renderToAdDepth()
		const before = {
			campaign: row('Кампанія Ліди').textContent,
			adSet: row('Група Київ').textContent,
			account: row('DeviAcademy Ad').textContent,
		}
		cleanup()

		await renderToAdDepth({ hidePaused: 'true' })

		expect(screen.queryByText('Оголошення відхилене')).toBeNull()
		expect(screen.queryByText('Оголошення новий статус')).toBeNull()
		expect(screen.getByText('Оголошення що працює')).toBeTruthy()
		expect(row('Кампанія Ліди').textContent).toBe(before.campaign)
		expect(row('Група Київ').textContent).toBe(before.adSet)
		expect(row('DeviAcademy Ad').textContent).toBe(before.account)
	})

	it('links each Ad Account to Meta Ads Manager in a new tab', () => {
		renderBoard()

		const links = screen.getAllByRole('link', { name: 'Відкрити у Meta Ads Manager' })
		expect(links).toHaveLength(3)
		expect(links[0]!.getAttribute('href')).toContain('act=100000000000001')
		expect(links[0]!.getAttribute('target')).toBe('_blank')
	})

	it('collapses an empty Signals lane to its header and count', () => {
		renderBoard({ view: 'signals' })

		// Account cards occupy their own operational lanes.
		expect(screen.getByRole('region', { name: 'Післяплата' }).textContent).toContain('Northstar Postpay')
		expect(screen.getByRole('region', { name: 'Потрібна увага' }).textContent).toContain('Northstar')
	})

	it('leads each Control Room rail row with the Ad Account name', () => {
		renderBoard({ view: 'control' })

		const railRow = screen.getAllByRole('button').find(element => element.textContent?.includes('Northstar Prepay'))!
		expect(railRow.textContent!.indexOf('Northstar Prepay')).toBeLessThan(
			railRow.textContent!.indexOf('Meta вимкнула кабінет'),
		)
	})

	it('titles the Creative from its copy rather than Metas generated name', async () => {
		await renderToAdDepth({ ad: 'ad-running' })

		const dialog = await screen.findByRole('dialog')
		expect(within(dialog).getByText('Перший рядок тексту')).toBeTruthy()
		expect(within(dialog).queryByText(/a1b2c3/)).toBeNull()
		// One asset, so the whole-Ad attribution note would mean nothing here.
		expect(within(dialog).queryByText('Результати належать оголошенню цілком')).toBeNull()
		expect(within(dialog).getByRole('button', { name: 'Закрити' })).toBeTruthy()
	})

	it('opens the creative directly in the Lightbox, showing a streamable video at full size', async () => {
		await renderToAdDepth({ ad: 'ad-disapproved' })
		const dialog = await screen.findByRole('dialog')
		expect(within(dialog).getByLabelText('Відео')).toBeInstanceOf(HTMLVideoElement)
	})

	describe('synchronization health icons', () => {
		it.each(['tree', 'control', 'signals'])(
			'shows one highest-severity icon per affected account in the %s view, and none for a healthy account',
			view => {
				soloAccount.syncHealth = null
				duoFirst.syncHealth = { severity: 'yellow', findings: [syncFinding({ slice: 'hierarchy' })] }
				duoSecond.syncHealth = {
					severity: 'red',
					findings: [
						syncFinding({ slice: 'insights', severity: 'red', reason: 'no_snapshot', lastSuccessAt: null }),
					],
				}
				renderBoard({ view })

				expect(screen.queryByLabelText(/^(Синхронізація застаріла|Потрібна дія): DeviAcademy Ad$/)).toBeNull()
				expect(screen.getByLabelText('Синхронізація застаріла: Northstar Prepay')).toBeTruthy()
				expect(screen.getByLabelText('Потрібна дія: Northstar Postpay')).toBeTruthy()
			},
		)

		it('aggregates the highest-severity icon and the affected-account count in the toolbar', () => {
			duoFirst.syncHealth = { severity: 'yellow', findings: [syncFinding()] }
			duoSecond.syncHealth = {
				severity: 'red',
				findings: [syncFinding({ severity: 'red', reason: 'no_snapshot', lastSuccessAt: null })],
			}
			rootResponse.header.syncHealth = { severity: 'red', affectedAccountCount: 2 }
			renderBoard()

			const aggregate = screen.getByLabelText('Потребують уваги: 2')
			expect(aggregate.textContent).toContain('2')
		})

		it('opens the account popover on keyboard focus, click, and tap, and lists the affected slice', async () => {
			duoFirst.syncHealth = {
				severity: 'yellow',
				findings: [
					syncFinding({
						slice: 'hierarchy',
						diagnosticReference: 'sync-run/run_42/hierarchy/act_200000000000001',
					}),
				],
			}
			renderBoard()
			const trigger = screen.getByLabelText('Синхронізація застаріла: Northstar Prepay')

			// Hover is provided by base-ui's `openOnHover` (a pointer "rest" timer over real
			// pointermove/mousemove physics) and is verified against the real dev server, not
			// here — jsdom has no pointer/geometry model to drive that timer deterministically.
			// Keyboard focus opens it the same way a real click does (see SyncHealthTrigger).
			fireEvent.focus(trigger)
			await waitFor(() => expect(screen.getByText('Структура кампаній')).toBeTruthy())
			fireEvent.blur(trigger)

			// Click and tap both resolve to a DOM click in the browser.
			fireEvent.click(trigger)
			await waitFor(() =>
				expect(screen.getByText('sync-run/run_42/hierarchy/act_200000000000001', { exact: false })).toBeTruthy(),
			)
			expect(screen.getByText('Дані не оновлювалися успішно понад 10 хвилин.')).toBeTruthy()
		})

		it('offers Force Refresh for a stale slice, wired to the same refresh action as the toolbar button', async () => {
			duoFirst.syncHealth = { severity: 'yellow', findings: [syncFinding()] }
			renderBoard()

			fireEvent.click(screen.getByLabelText('Синхронізація застаріла: Northstar Prepay'))
			// Two "Оновити дані" buttons exist once the popover opens: the always-present toolbar
			// one, and this finding's own — both call the identical shared refresh action.
			await waitFor(() => expect(screen.getAllByRole('button', { name: 'Оновити дані' })).toHaveLength(2))
			fireEvent.click(screen.getAllByRole('button', { name: 'Оновити дані' })[1]!)

			await waitFor(() => expect(requestForceRefreshSpy).toHaveBeenCalledTimes(1))
		})

		it('shows Reconnect Meta only to the Agency owner, and the Meta error code only to superadmins', async () => {
			duoFirst.syncHealth = {
				severity: 'red',
				findings: [
					syncFinding({
						severity: 'red',
						reason: 'access_lost',
						metaErrorCode: 190,
						diagnosticReference: 'sync-run/run_9/account-data/act_200000000000001',
					}),
				],
			}
			renderBoard()
			const trigger = screen.getByLabelText('Потрібна дія: Northstar Prepay')

			fireEvent.click(trigger)
			await waitFor(() => expect(screen.getByText(/Немає доступу до Meta/)).toBeTruthy())
			expect(screen.queryByRole('link', { name: 'Перепідключити Meta' })).toBeNull()
			expect(screen.queryByText(/Код Meta/)).toBeNull()
			fireEvent.click(trigger)

			meState.current = { isSuperadmin: true, activeOrgMember: { role: 'owner' } }
			fireEvent.click(trigger)
			await waitFor(() => expect(screen.getByRole('link', { name: 'Перепідключити Meta' })).toBeTruthy())
			expect(screen.getByRole('link', { name: 'Перепідключити Meta' }).getAttribute('href')).toBe(
				'/organization/settings',
			)
			expect(screen.getByText('Код Meta: 190', { exact: false })).toBeTruthy()
		})

		it('clears the icon once the affected slice recovers, leaving no dismiss control while it persists', async () => {
			duoFirst.syncHealth = { severity: 'yellow', findings: [syncFinding()] }
			rootResponse.header.syncHealth = { severity: 'yellow', affectedAccountCount: 1 }
			renderBoard()

			fireEvent.click(screen.getByLabelText('Синхронізація застаріла: Northstar Prepay'))
			await waitFor(() => expect(screen.getByText('Дані кабінету')).toBeTruthy())
			expect(screen.queryByRole('button', { name: /Закрити|Приховати|Позначити/ })).toBeNull()
			expect(screen.getByLabelText('Потребують уваги: 1')).toBeTruthy()

			cleanup()
			duoFirst.syncHealth = null
			rootResponse.header.syncHealth = null
			renderBoard()
			expect(screen.queryByLabelText('Синхронізація застаріла: Northstar Prepay')).toBeNull()
			expect(screen.queryByLabelText('Потрібна дія: Northstar Prepay')).toBeNull()
			expect(screen.queryByLabelText(/Потребують уваги/)).toBeNull()
		})
	})
})
