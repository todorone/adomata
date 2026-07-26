import { useEffect, useState, type ReactNode } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	ArrowUpDown,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Filter,
	ImageOff,
	Layers3,
	LayoutGrid,
	ListFilter,
	PanelLeft,
	Play,
	Search,
	Sparkles,
	ExternalLink,
	Users,
} from 'lucide-react'
import { z } from 'zod'

export const Route = createFileRoute('/prototype/fleet-board')({
	validateSearch: z.object({ variant: z.enum(['A', 'B', 'C']).optional() }),
	component: FleetBoardPrototype,
})

type Health = 'green' | 'yellow' | 'red'
type MetricKey = 'spend' | 'roas' | 'clicks' | 'ctr'
type Depth = 0 | 1 | 2 | 3

type Metrics = {
	spend: number
	roas: number
	clicks: number
	ctr: number
}

type CreativeKind = 'image' | 'video' | 'carousel' | 'asset-feed'
type CreativeAsset = {
	id: string
	label: string
	title: string
	imageUrl: string
	placement?: string
}
type Creative = {
	kind: CreativeKind
	formatLabel: string
	body: string
	headline: string
	cta: string
	destination: string
	assets: CreativeAsset[]
	mediaAvailable: boolean
}
type Ad = { id: string; name: string; status: 'Активне' | 'Пауза'; metrics: Metrics; creative: Creative }
type AdSet = { id: string; name: string; status: 'Активна' | 'Пауза'; metrics: Metrics; ads: Ad[] }
type Campaign = {
	id: string
	name: string
	status: 'Активна' | 'Пауза'
	metrics: Metrics
	adSets: AdSet[]
}
type Account = {
	id: string
	name: string
	client: string
	health: Health
	balance: number
	status: 'Активний' | 'Відстрочка' | 'Проблема'
	metrics: Metrics
	lastSync: string
	campaigns: Campaign[]
}

type VariantKey = 'A' | 'B' | 'C'

const DEPTH_LABELS = ['Кабінети', 'Кампанії', 'Групи оголошень', 'Оголошення']
const METRICS: Array<{ key: MetricKey; label: string }> = [
	{ key: 'spend', label: 'Витрати' },
	{ key: 'roas', label: 'ROAS' },
	{ key: 'clicks', label: 'Кліки' },
	{ key: 'ctr', label: 'CTR' },
]
const VARIANTS: Array<{ key: VariantKey; name: string; hint: string }> = [
	{ key: 'A', name: 'Дерево', hint: 'Порівняння всіх кабінетів' },
	{ key: 'B', name: 'Пульт', hint: 'Фокус на одному кабінеті' },
	{ key: 'C', name: 'Сигнали', hint: 'Операційна дошка проблем' },
]

const CLIENTS = [
	'Nova Forma',
	'Green Basket',
	'Vector House',
	'Light Studio',
	'Urban Pulse',
	'Mango Lab',
	'North Star',
	'Kolo Market',
	'Bright Dental',
	'Craft & Co',
]

const CREATIVE_PALETTES = [
	['#0e5555', '#f4c16e'],
	['#bb5c3c', '#f5dfaf'],
	['#3f5b9a', '#9ed4d2'],
	['#7b4e86', '#f0a878'],
	['#21694f', '#d6e68f'],
]

function creativeImage(seed: number, index: number) {
	const [start, end] = CREATIVE_PALETTES[(seed + index) % CREATIVE_PALETTES.length]
	const title = ['ЛІДИ', 'ДЛЯ ТЕБЕ', 'НОВИНКА', 'ПОРУЧ', 'ТЕСТ'][index % 5]
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 560"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="900" height="560" fill="url(#g)"/><circle cx="710" cy="110" r="180" fill="white" fill-opacity=".18"/><circle cx="140" cy="500" r="230" fill="black" fill-opacity=".12"/><text x="64" y="96" fill="white" font-family="Arial,sans-serif" font-size="34" font-weight="700" letter-spacing="7">ADOMATA / CREATIVE</text><text x="64" y="390" fill="white" font-family="Arial,sans-serif" font-size="92" font-weight="800">${title}</text><rect x="68" y="430" width="190" height="7" rx="3" fill="white" fill-opacity=".8"/></svg>`
	return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function creativeAsset(seed: number, index: number, placement?: string): CreativeAsset {
	return {
		id: `asset-${seed}-${index}`,
		label: `Варіант ${String.fromCharCode(65 + index)}`,
		title: ['Ранковий ритуал', 'Вигода поруч', 'Спробуйте сьогодні', 'Деталі, що працюють'][index % 4],
		imageUrl: creativeImage(seed, index),
		placement,
	}
}

function creativeFor(seed: number): Creative {
	const base = {
		body: 'Зробіть наступний крок разом із брендом, якому довіряють щодня.',
		headline: 'Більше результату з кожного кліка',
		cta: 'Дізнатися більше',
		destination: 'nov forma.ua/offer',
	}
	if (seed % 13 === 0) {
		return {
			...base,
			kind: 'image',
			formatLabel: 'Зображення · недоступне',
			assets: [{ ...creativeAsset(seed, 0), imageUrl: 'https://cdn.adomata.local/prototype-expired.jpg' }],
			mediaAvailable: false,
		}
	}
	if (seed % 4 === 0) {
		return {
			...base,
			kind: 'video',
			formatLabel: 'Відео · прев’ю',
			assets: [creativeAsset(seed, 0)],
			mediaAvailable: true,
		}
	}
	if (seed % 5 === 0) {
		return {
			...base,
			kind: 'carousel',
			formatLabel: 'Карусель · 4 картки',
			assets: Array.from({ length: 4 }, (_, index) => creativeAsset(seed, index)),
			mediaAvailable: true,
		}
	}
	if (seed % 6 === 0) {
		return {
			...base,
			kind: 'asset-feed',
			formatLabel: 'Набір ресурсів · 5 варіантів',
			assets: [
				creativeAsset(seed, 0, 'Стрічка · мобільна'),
				creativeAsset(seed, 1, 'Stories · вертикальна'),
				creativeAsset(seed, 2, 'Reels · вертикальна'),
				creativeAsset(seed, 3, 'Стрічка · широка'),
				creativeAsset(seed, 4, 'Audience Network'),
			],
			mediaAvailable: true,
		}
	}
	return {
		...base,
		kind: 'image',
		formatLabel: 'Зображення',
		assets: [creativeAsset(seed, 0)],
		mediaAvailable: true,
	}
}

function metricsFor(seed: number, multiplier = 1): Metrics {
	return {
		spend: Math.round((1200 + ((seed * 743) % 8800)) * multiplier),
		roas: Number((1.4 + ((seed * 17) % 38) / 10).toFixed(1)),
		clicks: Math.round((180 + ((seed * 113) % 2900)) * multiplier),
		ctr: Number((0.8 + ((seed * 13) % 62) / 10).toFixed(1)),
	}
}

function makeAccounts(): Account[] {
	return Array.from({ length: 50 }, (_, index) => {
		const number = index + 1
		const health: Health = number % 11 === 0 || number % 17 === 0 ? 'red' : number % 7 === 0 ? 'yellow' : 'green'
		const campaignCount = number % 5 === 0 ? 0 : 1 + (number % 3)
		const campaigns: Campaign[] = Array.from({ length: campaignCount }, (_, campaignIndex) => {
			const campaignNumber = campaignIndex + 1
			const adSetCount = 1 + ((number + campaignNumber) % 2)
			const adSets: AdSet[] = Array.from({ length: adSetCount }, (_, adSetIndex) => {
				const adSetNumber = adSetIndex + 1
				const ads: Ad[] = Array.from({ length: 1 + ((number + adSetNumber) % 3) }, (_, adIndex) => ({
					id: `ad-${number}-${campaignNumber}-${adSetNumber}-${adIndex}`,
					name: `Креатив ${adIndex + 1}: тест ${['A', 'B', 'C'][adIndex % 3]}`,
					status: adIndex === 2 ? 'Пауза' : 'Активне',
					metrics: metricsFor(number + campaignNumber + adSetNumber + adIndex, 0.18),
					creative: creativeFor(number + campaignNumber + adSetNumber + adIndex),
				}))
				return {
					id: `adset-${number}-${campaignNumber}-${adSetNumber}`,
					name: `Група ${adSetNumber} · ${['Широка', 'Ретаргетинг'][adSetIndex % 2]}`,
					status: adSetIndex === 1 && number % 4 === 0 ? 'Пауза' : 'Активна',
					metrics: metricsFor(number + campaignNumber + adSetNumber, 0.42),
					ads,
				}
			})
			return {
				id: `campaign-${number}-${campaignNumber}`,
				name: `${['Весняний запуск', 'Каталог', 'Лідогенерація'][campaignIndex % 3]} · ${CLIENTS[index % CLIENTS.length]}`,
				status: campaignNumber === 2 && number % 6 === 0 ? 'Пауза' : 'Активна',
				metrics: metricsFor(number + campaignNumber, 0.7),
				adSets,
			}
		})
		return {
			id: `account-${number}`,
			name: `Meta UA · ${String(number).padStart(2, '0')}`,
			client: CLIENTS[index % CLIENTS.length],
			health,
			balance: health === 'red' ? 4300 + number * 137 : health === 'yellow' ? 0 : number % 4 === 0 ? 260 : 0,
			status: health === 'red' ? 'Проблема' : health === 'yellow' ? 'Відстрочка' : 'Активний',
			metrics: metricsFor(number),
			lastSync: `${8 + (number % 4)}:${String((number * 7) % 60).padStart(2, '0')}`,
			campaigns,
		}
	})
}

const ACCOUNTS = makeAccounts()

function money(value: number) {
	return new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function metricValue(metrics: Metrics, key: MetricKey) {
	if (key === 'spend') return money(metrics.spend)
	if (key === 'roas') return `${metrics.roas}×`
	if (key === 'clicks') return metrics.clicks.toLocaleString('uk-UA')
	return `${metrics.ctr}%`
}

function healthLabel(health: Health) {
	return health === 'green' ? 'Все гаразд' : health === 'yellow' ? 'Відстрочка' : 'Потрібна увага'
}

function healthClass(health: Health) {
	return health === 'green'
		? 'prototype-health-green'
		: health === 'yellow'
			? 'prototype-health-yellow'
			: 'prototype-health-red'
}

function MetricChips({ metrics, setMetrics }: { metrics: Set<MetricKey>; setMetrics: (next: Set<MetricKey>) => void }) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<span className="mr-1 text-xs font-bold uppercase tracking-[0.13em] text-[var(--sea-ink-soft)]">Метрики</span>
			{METRICS.map(metric => {
				const active = metrics.has(metric.key)
				return (
					<button
						key={metric.key}
						type="button"
						aria-pressed={active}
						onClick={() => {
							const next = new Set(metrics)
							if (active) next.delete(metric.key)
							else next.add(metric.key)
							setMetrics(next)
						}}
						className={`prototype-metric-chip ${active ? 'prototype-metric-chip-active' : ''}`}
					>
						{metric.label}
					</button>
				)
			})}
		</div>
	)
}

function DepthControl({ depth, setDepth }: { depth: Depth; setDepth: (depth: Depth) => void }) {
	return (
		<div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white/60 p-1">
			{DEPTH_LABELS.map((label, index) => (
				<button
					key={label}
					type="button"
					aria-pressed={depth === index}
					onClick={() => setDepth(index as Depth)}
					className={`prototype-depth-button ${depth === index ? 'prototype-depth-button-active' : ''}`}
				>
					<span className="hidden sm:inline">{index + 1} · </span>
					{label}
				</button>
			))}
		</div>
	)
}

function MetricStrip({ account, metrics }: { account: Account; metrics: Set<MetricKey> }) {
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--sea-ink-soft)]">
			{METRICS.filter(metric => metrics.has(metric.key)).map(metric => (
				<span key={metric.key}>
					<b className="text-[var(--sea-ink)]">{metricValue(account.metrics, metric.key)}</b>{' '}
					{metric.label.toLowerCase()}
				</span>
			))}
		</div>
	)
}

function CreativeMetrics({ metrics, metricKeys }: { metrics: Metrics; metricKeys: Set<MetricKey> }) {
	return (
		<div className="prototype-creative-metrics">
			{METRICS.filter(metric => metricKeys.has(metric.key)).map(metric => (
				<div key={metric.key}>
					<strong>{metricValue(metrics, metric.key)}</strong>
					<span>{metric.label}</span>
				</div>
			))}
		</div>
	)
}

function CreativeMedia({ asset, kind, available }: { asset: CreativeAsset; kind: CreativeKind; available: boolean }) {
	const [failed, setFailed] = useState(!available)
	if (failed) {
		return (
			<div className="prototype-creative-media prototype-creative-media-missing">
				<ImageOff className="size-5" />
				<span>Медіа недоступне</span>
			</div>
		)
	}
	return (
		<div className="prototype-creative-media">
			<img src={asset.imageUrl} alt={asset.title} onError={() => setFailed(true)} />
			{kind === 'video' && (
				<span className="prototype-video-badge">
					<Play className="size-3 fill-current" /> Відео
				</span>
			)}
		</div>
	)
}

function CreativePreview({
	ad,
	metricKeys,
	surface,
}: {
	ad: Ad
	metricKeys: Set<MetricKey>
	surface: 'inline' | 'panel' | 'compact'
}) {
	const { creative } = ad
	const collection = creative.kind === 'carousel' || creative.kind === 'asset-feed'
	return (
		<div className={`prototype-creative prototype-creative-${surface}`}>
			<div className="prototype-creative-main">
				<CreativeMedia asset={creative.assets[0]} kind={creative.kind} available={creative.mediaAvailable} />
				<div className="min-w-0 flex-1">
					<div className="mb-1 flex flex-wrap items-center gap-2">
						<span className="prototype-creative-format">
							{creative.kind === 'video' ? <Play className="size-3" /> : <Layers3 className="size-3" />}
							{creative.formatLabel}
						</span>
						<span className="text-[11px] text-[var(--sea-ink-soft)]">{ad.status}</span>
					</div>
					<div className="truncate text-sm font-extrabold text-[var(--sea-ink)]">{creative.headline}</div>
					<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--sea-ink-soft)]">{creative.body}</p>
					<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--sea-ink-soft)]">
						<span className="font-bold text-[var(--sea-ink)]">{creative.cta}</span>
						<span className="inline-flex items-center gap-1">
							<ExternalLink className="size-3" /> {creative.destination}
						</span>
					</div>
				</div>
				<CreativeMetrics metrics={ad.metrics} metricKeys={metricKeys} />
			</div>
			{collection && (
				<div className="prototype-creative-assets">
					<div className="prototype-creative-assets-heading">
						<span>{creative.kind === 'carousel' ? 'Усі картки каруселі' : 'Варіанти набору ресурсів'}</span>
						<span>{creative.assets.length} ресурсів</span>
					</div>
					<div className="prototype-creative-assets-grid">
						{creative.assets.map(asset => (
							<div key={asset.id} className="prototype-creative-asset">
								<CreativeMedia asset={asset} kind="image" available={creative.mediaAvailable} />
								<div className="mt-1 truncate text-[11px] font-bold">{asset.label}</div>
								{asset.placement && (
									<div className="truncate text-[10px] text-[var(--sea-ink-soft)]">{asset.placement}</div>
								)}
							</div>
						))}
					</div>
					<p className="mt-2 text-[11px] text-[var(--sea-ink-soft)]">
						{creative.kind === 'carousel'
							? 'Показано всі картки; результати атрибутовано на рівні оголошення.'
							: 'Meta підбирає комбінацію за розміщенням; результати атрибутовано на рівні оголошення.'}
					</p>
				</div>
			)}
		</div>
	)
}

function PrototypeHeader({
	variant,
	depth,
	setDepth,
	metrics,
	setMetrics,
}: {
	variant: VariantKey
	depth: Depth
	setDepth: (depth: Depth) => void
	metrics: Set<MetricKey>
	setMetrics: (metrics: Set<MetricKey>) => void
}) {
	const current = VARIANTS.find(item => item.key === variant)!
	return (
		<div className="mb-5 flex flex-col gap-5">
			<div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
				<div>
					<div className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--kicker)]">
						<Sparkles className="size-3.5" /> PROTOTYPE · #16 · ВАРІАНТ {variant}
					</div>
					<h1 className="display-title text-4xl leading-none text-[var(--sea-ink)] sm:text-5xl">{current.name}</h1>
					<p className="mt-2 max-w-2xl text-sm text-[var(--sea-ink-soft)]">
						{current.hint}. 50 кабінетів · стан на сьогодні, 10:32.
					</p>
				</div>
				<div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-right shadow-sm">
					<div className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--sea-ink-soft)]">
						Глибина зараз
					</div>
					<div className="mt-1 text-lg font-extrabold text-[var(--sea-ink)]">{DEPTH_LABELS[depth]}</div>
				</div>
			</div>
			<div className="island-shell flex flex-col gap-4 rounded-3xl p-4 lg:flex-row lg:items-center lg:justify-between">
				<DepthControl depth={depth} setDepth={setDepth} />
				<MetricChips metrics={metrics} setMetrics={setMetrics} />
			</div>
		</div>
	)
}

function TreeRow({
	level,
	name,
	status,
	metrics,
	metricKeys,
	open,
	onToggle,
	last,
}: {
	level: number
	name: string
	status: string
	metrics: Metrics
	metricKeys: Set<MetricKey>
	open: boolean
	onToggle: () => void
	last?: boolean
}) {
	return (
		<div className={`prototype-tree-row ${last ? 'border-b-0' : ''}`}>
			<div className="flex min-w-[270px] items-center gap-2" style={{ paddingLeft: `${level * 28 + 10}px` }}>
				<button
					type="button"
					onClick={onToggle}
					className="rounded-md p-1 text-[var(--sea-ink-soft)] hover:bg-black/5"
					aria-label={open ? 'Згорнути' : 'Розгорнути'}
				>
					{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
				</button>
				<span className={`prototype-level-mark level-${level}`} />
				<span className="truncate font-semibold text-[var(--sea-ink)]">{name}</span>
			</div>
			<div className="text-xs font-semibold text-[var(--sea-ink-soft)]">{status}</div>
			{METRICS.map(metric => (
				<div
					key={metric.key}
					className={`text-right text-sm ${metricKeys.has(metric.key) ? 'text-[var(--sea-ink)]' : 'text-transparent'}`}
				>
					{metricKeys.has(metric.key) ? metricValue(metrics, metric.key) : '—'}
				</div>
			))}
		</div>
	)
}

function VariantA({ accounts, metrics, setMetrics, depth, setDepth }: PrototypeProps) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
	const [query, setQuery] = useState('')
	const [onlyAttention, setOnlyAttention] = useState(false)
	const visibleAccounts = accounts.filter(account => {
		const matchesQuery = `${account.name} ${account.client}`.toLowerCase().includes(query.toLowerCase())
		return matchesQuery && (!onlyAttention || account.health !== 'green')
	})

	function toggle(id: string) {
		const next = new Set(expanded)
		if (next.has(id)) next.delete(id)
		else next.add(id)
		setExpanded(next)
	}

	function rowsFor(account: Account) {
		const rows: ReactNode[] = []
		const accountOpen = depth > 0 || expanded.has(account.id)
		rows.push(
			<TreeRow
				key={account.id}
				level={0}
				name={`${account.client}  ·  ${account.name}`}
				status={account.status}
				metrics={account.metrics}
				metricKeys={metrics}
				open={accountOpen}
				onToggle={() => toggle(account.id)}
			/>,
		)
		if (!accountOpen) return rows
		if (account.campaigns.length === 0) {
			rows.push(
				<TreeRow
					key={`${account.id}-empty`}
					level={1}
					name="Немає активних кампаній"
					status="—"
					metrics={account.metrics}
					metricKeys={new Set()}
					open={false}
					onToggle={() => undefined}
					last
				/>,
			)
			return rows
		}
		account.campaigns.forEach(campaign => {
			const campaignOpen = depth > 1 || expanded.has(campaign.id)
			rows.push(
				<TreeRow
					key={campaign.id}
					level={1}
					name={campaign.name}
					status={campaign.status}
					metrics={campaign.metrics}
					metricKeys={metrics}
					open={campaignOpen}
					onToggle={() => toggle(campaign.id)}
				/>,
			)
			if (!campaignOpen) return
			campaign.adSets.forEach(adSet => {
				const adSetOpen = depth > 2 || expanded.has(adSet.id)
				rows.push(
					<TreeRow
						key={adSet.id}
						level={2}
						name={adSet.name}
						status={adSet.status}
						metrics={adSet.metrics}
						metricKeys={metrics}
						open={adSetOpen}
						onToggle={() => toggle(adSet.id)}
					/>,
				)
				if (!adSetOpen) return
				adSet.ads.forEach(ad => {
					const adOpen = expanded.has(ad.id)
					rows.push(
						<TreeRow
							key={ad.id}
							level={3}
							name={ad.name}
							status={ad.status}
							metrics={ad.metrics}
							metricKeys={metrics}
							open={adOpen}
							onToggle={() => toggle(ad.id)}
							last={!adOpen}
						/>,
					)
					if (adOpen) {
						rows.push(
							<div key={`${ad.id}-creative`} className="prototype-tree-creative-row min-w-[760px]">
								<CreativePreview ad={ad} metricKeys={metrics} surface="inline" />
							</div>,
						)
					}
				})
			})
		})
		return rows
	}

	return (
		<div className="prototype-variant prototype-variant-a">
			<PrototypeHeader variant="A" depth={depth} setDepth={setDepth} metrics={metrics} setMetrics={setMetrics} />
			<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2 text-sm text-[var(--sea-ink-soft)]">
					<Users className="size-4" /> Порівняння зберігається на всіх рівнях
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<label className="prototype-input-wrap">
						<Search className="size-4" />
						<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Знайти клієнта…" />
					</label>
					<button
						type="button"
						className={`prototype-filter-button ${onlyAttention ? 'prototype-filter-button-active' : ''}`}
						onClick={() => setOnlyAttention(!onlyAttention)}
					>
						<Filter className="size-3.5" /> Лише увага
					</button>
				</div>
			</div>
			<div className="island-shell overflow-hidden rounded-3xl">
				<div className="prototype-tree-head min-w-[760px]">
					<div className="pl-10">
						Кабінет / ієрархія <span className="ml-1 text-[var(--sea-ink-soft)]">({visibleAccounts.length})</span>
					</div>
					<div>Стан</div>
					{METRICS.map(metric => (
						<div key={metric.key} className="text-right">
							{metrics.has(metric.key) ? metric.label : ''}
						</div>
					))}
				</div>
				<div className="min-w-[760px]">{visibleAccounts.map(account => rowsFor(account))}</div>
			</div>
			<div className="mt-3 flex items-center justify-between text-xs text-[var(--sea-ink-soft)]">
				<span>
					Батьківський рядок показує власний агрегат · натисніть оголошення, щоб відкрити креатив і його метрики.
				</span>
				<span>{visibleAccounts.length} / 50</span>
			</div>
		</div>
	)
}

function DetailTree({ account, depth, metrics }: { account: Account; depth: Depth; metrics: Set<MetricKey> }) {
	const [selectedAdId, setSelectedAdId] = useState('')
	const allAds = account.campaigns.flatMap(campaign => campaign.adSets.flatMap(adSet => adSet.ads))
	const selectedAd = allAds.find(ad => ad.id === selectedAdId) ?? allAds[0]
	return (
		<div className="flex flex-col gap-2">
			{account.campaigns.length === 0 && (
				<div className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--sea-ink-soft)]">
					У цьому кабінеті поки немає кампаній.
				</div>
			)}
			{account.campaigns.map(campaign => (
				<div key={campaign.id} className="rounded-2xl border border-[var(--line)] bg-white/55 p-3">
					<div className="flex items-center justify-between gap-3">
						<div>
							<div className="text-sm font-extrabold">{campaign.name}</div>
							<div className="mt-1 text-xs text-[var(--sea-ink-soft)]">
								{campaign.status} · {metricValue(campaign.metrics, 'spend')}
							</div>
						</div>
						<span className="prototype-status-pill">Кампанія</span>
					</div>
					{depth >= 2 && (
						<div className="mt-3 grid gap-2 sm:grid-cols-2">
							{campaign.adSets.map(adSet => (
								<div key={adSet.id} className="rounded-xl bg-[var(--foam)] p-3">
									<div className="text-xs font-bold">{adSet.name}</div>
									<div className="mt-1 text-xs text-[var(--sea-ink-soft)]">
										{adSet.status} · {metricValue(adSet.metrics, 'clicks')} кліків
									</div>
									{depth >= 3 && (
										<div className="mt-2 border-t border-[var(--line)] pt-2 text-xs text-[var(--sea-ink-soft)]">
											{adSet.ads.map(ad => (
												<div key={ad.id} className="flex justify-between py-1">
													<span>{ad.name}</span>
													<span>{ad.status}</span>
												</div>
											))}
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			))}
			{depth >= 3 ? (
				<div className="prototype-detail-creative-shell">
					<div className="mb-3 flex items-start justify-between gap-3">
						<div>
							<div className="text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--kicker)]">
								Креатив оголошення
							</div>
							<p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
								Виберіть оголошення зліва — деталі та метрики залишаються поруч.
							</p>
						</div>
						<span className="prototype-creative-format">{allAds.length} огол.</span>
					</div>
					{selectedAd ? (
						<div className="prototype-detail-creative-layout">
							<div className="prototype-detail-ad-list">
								{allAds.map(ad => (
									<button
										key={ad.id}
										type="button"
										onClick={() => setSelectedAdId(ad.id)}
										className={`prototype-detail-ad-button ${selectedAd.id === ad.id ? 'prototype-detail-ad-button-active' : ''}`}
									>
										<span className="truncate text-left font-bold">{ad.name}</span>
										<span className="text-[10px] text-[var(--sea-ink-soft)]">{ad.creative.formatLabel}</span>
									</button>
								))}
							</div>
							<CreativePreview ad={selectedAd} metricKeys={metrics} surface="panel" />
						</div>
					) : (
						<div className="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--sea-ink-soft)]">
							У цьому кабінеті немає оголошень.
						</div>
					)}
				</div>
			) : (
				<div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-xs text-[var(--sea-ink-soft)]">
					Перемкніть глибину на «Оголошення», щоб перевірити панель креативу.
				</div>
			)}
			<div className="flex flex-wrap gap-4 border-t border-[var(--line)] pt-3 text-xs text-[var(--sea-ink-soft)]">
				{METRICS.filter(metric => metrics.has(metric.key)).map(metric => (
					<span key={metric.key}>
						<b className="text-[var(--sea-ink)]">{metricValue(account.metrics, metric.key)}</b>{' '}
						{metric.label.toLowerCase()}
					</span>
				))}
			</div>
		</div>
	)
}

function VariantB({ accounts, metrics, setMetrics, depth, setDepth }: PrototypeProps) {
	const [selectedId, setSelectedId] = useState(accounts[0].id)
	const [query, setQuery] = useState('')
	const [sortBy, setSortBy] = useState<'name' | 'balance'>('balance')
	const selected = accounts.find(account => account.id === selectedId) ?? accounts[0]
	const visibleAccounts = accounts
		.filter(account => `${account.name} ${account.client}`.toLowerCase().includes(query.toLowerCase()))
		.sort((a, b) => (sortBy === 'balance' ? b.balance - a.balance : a.client.localeCompare(b.client)))

	return (
		<div className="prototype-variant prototype-variant-b">
			<PrototypeHeader variant="B" depth={depth} setDepth={setDepth} metrics={metrics} setMetrics={setMetrics} />
			<div className="prototype-control-room">
				<aside className="prototype-account-rail">
					<div className="mb-4 flex items-center justify-between">
						<div>
							<div className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--kicker)]">
								Навігація
							</div>
							<h2 className="mt-1 text-xl font-extrabold">Кабінети</h2>
						</div>
						<span className="rounded-full bg-[var(--sand)] px-2 py-1 text-xs font-bold">50</span>
					</div>
					<label className="prototype-input-wrap mb-3 w-full">
						<Search className="size-4" />
						<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Пошук…" />
					</label>
					<button
						type="button"
						className="mb-3 flex items-center gap-2 text-xs font-bold text-[var(--sea-ink-soft)]"
						onClick={() => setSortBy(sortBy === 'balance' ? 'name' : 'balance')}
					>
						<ArrowUpDown className="size-3.5" /> Сортувати: {sortBy === 'balance' ? 'борг' : 'назва'}
					</button>
					<div className="flex flex-col gap-1.5">
						{visibleAccounts.map(account => (
							<button
								key={account.id}
								type="button"
								onClick={() => setSelectedId(account.id)}
								className={`prototype-account-list-row ${selected.id === account.id ? 'prototype-account-list-row-active' : ''}`}
							>
								<span className={`prototype-health-dot ${healthClass(account.health)}`} />
								<span className="min-w-0 flex-1 text-left">
									<span className="block truncate text-sm font-bold">{account.client}</span>
									<span className="block truncate text-[11px] text-[var(--sea-ink-soft)]">{account.name}</span>
								</span>
								<span className="text-right text-xs font-bold">
									{account.balance ? money(account.balance) : '—'}
								</span>
							</button>
						))}
					</div>
				</aside>
				<main className="prototype-room-main">
					<div className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-start">
						<div>
							<div className="mb-2 flex items-center gap-2">
								<span className={`prototype-health-dot ${healthClass(selected.health)}`} />
								<span className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--sea-ink-soft)]">
									{healthLabel(selected.health)}
								</span>
							</div>
							<h2 className="display-title text-3xl text-[var(--sea-ink)]">{selected.client}</h2>
							<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
								{selected.name} · остання синхронізація {selected.lastSync}
							</p>
						</div>
						<div className="text-left sm:text-right">
							<div className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--sea-ink-soft)]">
								До сплати
							</div>
							<div
								className={`mt-1 text-2xl font-extrabold ${selected.balance ? 'text-[#b94d40]' : 'text-[var(--palm)]'}`}
							>
								{selected.balance ? money(selected.balance) : 'Немає боргу'}
							</div>
						</div>
					</div>
					<div className="grid gap-3 py-5 sm:grid-cols-3">
						<div className="prototype-room-stat">
							<span>Кампанії</span>
							<strong>{selected.campaigns.length}</strong>
						</div>
						<div className="prototype-room-stat">
							<span>Активні</span>
							<strong>{selected.campaigns.filter(campaign => campaign.status === 'Активна').length}</strong>
						</div>
						<div className="prototype-room-stat">
							<span>Витрати</span>
							<strong>{money(selected.metrics.spend)}</strong>
						</div>
					</div>
					<div className="mb-3 flex items-center justify-between">
						<h3 className="text-sm font-extrabold uppercase tracking-[0.12em] text-[var(--sea-ink-soft)]">
							Вміст кабінету
						</h3>
						<span className="text-xs text-[var(--sea-ink-soft)]">Глибина: {DEPTH_LABELS[depth]}</span>
					</div>
					<DetailTree account={selected} depth={depth} metrics={metrics} />
				</main>
			</div>
			<div className="mt-3 flex items-center gap-2 text-xs text-[var(--sea-ink-soft)]">
				<PanelLeft className="size-3.5" /> Список зберігає контекст, а основна область повністю присвячена одному
				кабінету.
			</div>
		</div>
	)
}

function VariantC({ accounts, metrics, setMetrics, depth, setDepth }: PrototypeProps) {
	const [open, setOpen] = useState<Set<string>>(new Set())
	const [query, setQuery] = useState('')
	const [showEmpty, setShowEmpty] = useState(true)
	const groups: Array<{ health: Health; title: string; description: string }> = [
		{ health: 'red', title: 'Потрібна увага', description: 'Борг або блокування' },
		{ health: 'yellow', title: 'На відстрочці', description: 'Контроль кредитної лінії' },
		{ health: 'green', title: 'Все гаразд', description: 'Активні й без боргу' },
	]
	const filtered = accounts.filter(account => {
		const found = `${account.client} ${account.name}`.toLowerCase().includes(query.toLowerCase())
		return found && (showEmpty || account.campaigns.length > 0)
	})

	function toggle(id: string) {
		const next = new Set(open)
		if (next.has(id)) next.delete(id)
		else next.add(id)
		setOpen(next)
	}

	return (
		<div className="prototype-variant prototype-variant-c">
			<div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
				<div>
					<div className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--kicker)]">
						<LayoutGrid className="size-3.5" /> PROTOTYPE · #16 · ВАРІАНТ C
					</div>
					<h1 className="display-title text-4xl leading-none text-[var(--sea-ink)] sm:text-5xl">Сигнали</h1>
					<p className="mt-2 max-w-2xl text-sm text-[var(--sea-ink-soft)]">
						Дошка для ранкового огляду: спершу проблеми, потім деталі. Картки розгортаються на місці.
					</p>
				</div>
				<div className="rounded-2xl bg-[var(--sea-ink)] px-4 py-3 text-white shadow-lg">
					<div className="text-xs font-bold uppercase tracking-[0.12em] text-white/65">Черга уваги</div>
					<div className="mt-1 text-lg font-extrabold">
						{accounts.filter(account => account.health === 'red').length} кабінетів
					</div>
				</div>
			</div>
			<div className="island-shell mb-5 flex flex-col gap-4 rounded-3xl p-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<DepthControl depth={depth} setDepth={setDepth} />
					<div className="flex flex-wrap gap-2">
						<label className="prototype-input-wrap">
							<Search className="size-4" />
							<input
								value={query}
								onChange={event => setQuery(event.target.value)}
								placeholder="Знайти клієнта…"
							/>
						</label>
						<button
							type="button"
							className={`prototype-filter-button ${showEmpty ? 'prototype-filter-button-active' : ''}`}
							onClick={() => setShowEmpty(!showEmpty)}
						>
							<ListFilter className="size-3.5" /> Порожні кампанії
						</button>
					</div>
				</div>
				<MetricChips metrics={metrics} setMetrics={setMetrics} />
			</div>
			<div className="grid gap-4 xl:grid-cols-3">
				{groups.map(group => {
					const groupAccounts = filtered.filter(account => account.health === group.health)
					return (
						<section key={group.health} className={`prototype-signal-lane ${healthClass(group.health)}`}>
							<div className="mb-3 flex items-start justify-between gap-3">
								<div>
									<h2 className="flex items-center gap-2 text-lg font-extrabold">
										<span className={`prototype-health-dot ${healthClass(group.health)}`} />
										{group.title}
									</h2>
									<p className="mt-1 text-xs text-[var(--sea-ink-soft)]">{group.description}</p>
								</div>
								<span className="rounded-full border border-current/10 bg-white/60 px-2 py-1 text-xs font-extrabold">
									{groupAccounts.length}
								</span>
							</div>
							<div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto pr-1">
								{groupAccounts.map(account => {
									const isOpen = open.has(account.id)
									return (
										<div
											key={account.id}
											className={`prototype-signal-card ${isOpen ? 'prototype-signal-card-open' : ''}`}
										>
											<button type="button" onClick={() => toggle(account.id)} className="w-full text-left">
												<div className="flex items-start gap-3">
													<span className="prototype-signal-number">
														{account.name.replace('Meta UA · ', '')}
													</span>
													<div className="min-w-0 flex-1">
														<div className="flex items-center justify-between gap-2">
															<span className="truncate text-sm font-extrabold">{account.client}</span>
															{isOpen ? (
																<ChevronDown className="size-4 shrink-0" />
															) : (
																<ChevronRight className="size-4 shrink-0" />
															)}
														</div>
														<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--sea-ink-soft)]">
															<span>{account.campaigns.length} кампаній</span>
															<span>{account.balance ? money(account.balance) : 'без боргу'}</span>
														</div>
													</div>
												</div>
												<MetricStrip account={account} metrics={metrics} />
											</button>
											{isOpen && (
												<div className="mt-3 border-t border-[var(--line)] pt-3">
													{account.campaigns.length === 0 ? (
														<p className="text-xs text-[var(--sea-ink-soft)]">
															Кампаній немає — це теж сигнал.
														</p>
													) : (
														account.campaigns.slice(0, depth === 0 ? 1 : undefined).map(campaign => (
															<div
																key={campaign.id}
																className="mb-2 rounded-xl bg-white/60 p-2.5 text-xs"
															>
																<div className="flex items-center justify-between gap-2 font-bold">
																	<span className="truncate">{campaign.name}</span>
																	<span className="shrink-0 text-[var(--sea-ink-soft)]">
																		{campaign.status}
																	</span>
																</div>
																{depth >= 2 && (
																	<div className="mt-2 space-y-1 border-l-2 border-[var(--line)] pl-2 text-[var(--sea-ink-soft)]">
																		{campaign.adSets.map(adSet => (
																			<div key={adSet.id}>
																				{adSet.name}
																				{depth >= 3 && (
																					<span className="ml-2 opacity-70">
																						· {adSet.ads.length} огол.
																					</span>
																				)}
																			</div>
																		))}
																	</div>
																)}
															</div>
														))
													)}
													{depth >= 3 &&
														account.campaigns.some(campaign =>
															campaign.adSets.some(adSet => adSet.ads.length > 0),
														) && (
															<div className="mt-3 border-t border-[var(--line)] pt-3">
																<div className="mb-2 flex items-center justify-between gap-2">
																	<span className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--kicker)]">
																		Креативи
																	</span>
																	<span className="text-[11px] text-[var(--sea-ink-soft)]">
																		На рівні оголошення
																	</span>
																</div>
																<div className="flex flex-col gap-2">
																	{account.campaigns
																		.flatMap(campaign => campaign.adSets.flatMap(adSet => adSet.ads))
																		.slice(0, 4)
																		.map(ad => (
																			<CreativePreview
																				key={ad.id}
																				ad={ad}
																				metricKeys={metrics}
																				surface="compact"
																			/>
																		))}
																</div>
															</div>
														)}
												</div>
											)}
										</div>
									)
								})}
							</div>
						</section>
					)
				})}
			</div>
			<div className="mt-3 flex items-center justify-between text-xs text-[var(--sea-ink-soft)]">
				<span>Картка відкриває наступний рівень, не залишаючи дошку.</span>
				<span>{filtered.length} кабінетів у фокусі</span>
			</div>
		</div>
	)
}

type PrototypeProps = {
	accounts: Account[]
	metrics: Set<MetricKey>
	setMetrics: (metrics: Set<MetricKey>) => void
	depth: Depth
	setDepth: (depth: Depth) => void
}

function PrototypeSwitcher({ current }: { current: VariantKey }) {
	const navigate = useNavigate({ from: Route.fullPath })
	const currentIndex = VARIANTS.findIndex(variant => variant.key === current)

	function setVariant(index: number) {
		const variant = VARIANTS[(index + VARIANTS.length) % VARIANTS.length].key
		navigate({ search: { variant }, replace: true })
	}

	useEffect(() => {
		function handleKey(event: globalThis.KeyboardEvent) {
			const target = event.target as HTMLElement | null
			if (target?.matches('input, textarea, [contenteditable="true"]')) return
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
			const offset = event.key === 'ArrowLeft' ? -1 : 1
			const nextVariant = VARIANTS[(currentIndex + offset + VARIANTS.length) % VARIANTS.length].key
			navigate({ search: { variant: nextVariant }, replace: true })
		}
		window.addEventListener('keydown', handleKey)
		return () => window.removeEventListener('keydown', handleKey)
	})

	if (import.meta.env.PROD) return null
	const item = VARIANTS[currentIndex]
	return (
		<div className="prototype-switcher" aria-label="Перемикач варіантів прототипу">
			<button type="button" onClick={() => setVariant(currentIndex - 1)} aria-label="Попередній варіант">
				<ChevronLeft className="size-4" />
			</button>
			<span>
				<b>{item.key}</b> · {item.name}
			</span>
			<button type="button" onClick={() => setVariant(currentIndex + 1)} aria-label="Наступний варіант">
				<ChevronRight className="size-4" />
			</button>
		</div>
	)
}

function FleetBoardPrototype() {
	const { variant: searchVariant } = Route.useSearch()
	const variant = searchVariant ?? 'A'
	const [depth, setDepth] = useState<Depth>(0)
	const [metrics, setMetrics] = useState<Set<MetricKey>>(new Set(['spend', 'roas']))

	function currentVariant() {
		if (variant === 'B')
			return (
				<VariantB accounts={ACCOUNTS} metrics={metrics} setMetrics={setMetrics} depth={depth} setDepth={setDepth} />
			)
		if (variant === 'C')
			return (
				<VariantC accounts={ACCOUNTS} metrics={metrics} setMetrics={setMetrics} depth={depth} setDepth={setDepth} />
			)
		return (
			<VariantA accounts={ACCOUNTS} metrics={metrics} setMetrics={setMetrics} depth={depth} setDepth={setDepth} />
		)
	}

	return (
		<>
			<div className="prototype-page-shell">{currentVariant()}</div>
			<PrototypeSwitcher current={variant} />
		</>
	)
}
