import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FleetBoardHierarchyResponse, FleetBoardRootResponse } from '@adomata/api/client'

import { fleetBoardSearchSchema, type FleetBoardSearch } from '@/data/fleet-board-search'

type Account = FleetBoardRootResponse['accounts'][number]
type Client = FleetBoardRootResponse['clients'][number]
type HierarchyNode = FleetBoardHierarchyResponse['nodes'][number]
type Kpis = Account['kpis']

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

const freshness = {
	accountTier: { refreshedAt: '2026-07-30T08:00:00.000Z', stale: false, failed: false },
	insightsTier: { refreshedAt: '2026-07-30T08:00:00.000Z', stale: false, failed: false },
}

const soloAccount: Account = {
	id: 'act_100000000000001',
	type: 'account',
	clientId: 'client-solo',
	clientName: 'DeviAcademy',
	name: 'DeviAcademy Ad',
	currency: 'UAH',
	timezoneName: 'Europe/Kyiv',
	amountOwed: '592284.00',
	connectionStatus: 'connected',
	health: { color: 'green', reason: { code: 'active' }, needsAttention: false },
	signalsLane: 'active',
	// No purchase value recorded anywhere on this lead-generation account.
	kpis: kpis({ spend: '1234.50', roas: '0' }),
	freshness,
}

const duoFirst: Account = {
	...soloAccount,
	id: 'act_200000000000001',
	clientId: 'client-duo',
	clientName: 'Northstar',
	name: 'Northstar Prepay',
	currency: 'USD',
	amountOwed: '10.00',
	health: { color: 'red', reason: { code: 'meta_disabled', disableReason: 3 }, needsAttention: true },
	signalsLane: 'needs_attention',
	kpis: kpis(),
}

const duoSecond: Account = {
	...duoFirst,
	id: 'act_200000000000002',
	name: 'Northstar Postpay',
	amountOwed: null,
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

const hierarchyNodes: HierarchyNode[] = [
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

const rootResponse: FleetBoardRootResponse = {
	clients: [soloClient, duoClient],
	accounts: [soloAccount, duoFirst, duoSecond],
	header: {
		accountTierRefreshedAt: '2026-07-30T08:00:00.000Z',
		insightsTierRefreshedAt: '2026-07-30T08:00:00.000Z',
		accountTierStale: false,
		insightsTierStale: false,
		accountTierNeverSynced: 0,
		insightsTierNeverSynced: 0,
		provisional: false,
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

const { childrenSpy } = vi.hoisted(() => ({ childrenSpy: vi.fn<(parents: Array<{ id: string }>) => void>() }))

vi.mock('@/data/fleet-board', () => ({
	useFleetBoardRoot: () => ({
		data: rootResponse,
		isPending: false,
		isError: false,
		refetch: () => Promise.resolve(),
	}),
	fleetBoardQueries: {
		children: (range: string, parents: Array<{ type: string; id: string }>) =>
			queryOptions({
				queryKey: ['fleet-board', 'children', range, parents] as const,
				queryFn: async () => {
					childrenSpy(parents)
					return { nodes: hierarchyNodes.filter(node => parents.some(parent => parent.id === node.parentId)) }
				},
			}),
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

const { FleetBoard } = await import('@/pages/fleet-board/fleet-board')

function money(value: string, currency: string) {
	return new Intl.NumberFormat('uk-UA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
		Number(value),
	)
}

function renderBoard(overrides: Record<string, unknown> = {}) {
	const search = fleetBoardSearchSchema.parse(overrides) as FleetBoardSearch
	return render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<FleetBoard search={search} setSearch={() => undefined} />
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
	// The one Ad that survives every rendering toggle, so this waits on hierarchy loading only.
	await waitFor(() => expect(screen.getByText('Оголошення що працює')).toBeTruthy())
}

describe('Fleet Board', () => {
	afterEach(() => {
		cleanup()
		childrenSpy.mockReset()
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
		const childRequests: Array<Array<{ id: string }>> = []
		childrenSpy.mockImplementation(parents => childRequests.push(parents))

		await renderToAdDepth()
		await new Promise(resolve => setTimeout(resolve, 50))

		// The two Northstar accounts have no children. Until their empty result was recorded they
		// read as "not loaded yet" forever, so the depth loader re-requested them without end.
		expect(screen.getByText('Northstar Prepay')).toBeTruthy()
		const emptyAccountRequests = childRequests.filter(parents => parents.some(parent => parent.id === duoFirst.id))
		expect(emptyAccountRequests).toHaveLength(1)
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

	it('puts amount owed on the Ad Account row and leaves interior rows empty', async () => {
		await renderToAdDepth()

		const owed = money('592284.00', 'UAH')
		expect(row('DeviAcademy Ad').textContent).toContain(owed)
		expect(row('Кампанія Ліди').textContent).not.toContain(owed)
		expect(row('Оголошення що працює').textContent).not.toContain(owed)
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
})
