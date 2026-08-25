export type ConnectionStatus = 'pending' | 'connected' | 'access_lost'
export type HealthColor = 'green' | 'yellow' | 'red' | 'grey'
export type SignalsLane = 'needs_attention' | 'postpay' | 'active'
export type TimeRangePreset =
	'today' | 'yesterday' | 'last7' | 'last14' | 'last30' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth'
export type CpaReason = 'mixed_result_types' | 'unresolved_result_type'

export type HealthReason =
	| { code: 'connection_pending' }
	| { code: 'connection_access_lost' }
	| { code: 'meta_disabled'; disableReason: number }
	| { code: 'meta_inactive'; accountStatus: number | null }
	| { code: 'postpay' }
	| { code: 'active' }

export type HealthState = {
	color: HealthColor
	reason: HealthReason
	needsAttention: boolean
}

type AccountHealthInput = {
	connectionStatus: ConnectionStatus
	metaAccountStatus?: number | null
	metaDisableReason?: number | null
	isPrepayAccount?: boolean | null
}

type UnknownMetaEnum = {
	field: 'account_status' | 'disable_reason'
	value: number
}

const knownAccountStatuses = new Set([1, 2, 3, 7, 8, 9, 100, 101])
const knownDisableReasons = new Set([0, 1, 2, 3, 4, 5, 6])

export function classifyAccountHealth(
	input: AccountHealthInput,
	onUnknownMetaEnum: (event: UnknownMetaEnum) => void = () => undefined,
): HealthState {
	if (input.connectionStatus === 'pending') {
		return { color: 'grey', reason: { code: 'connection_pending' }, needsAttention: false }
	}
	if (input.connectionStatus === 'access_lost') {
		return { color: 'grey', reason: { code: 'connection_access_lost' }, needsAttention: true }
	}

	const accountStatus = input.metaAccountStatus ?? null
	const disableReason = input.metaDisableReason ?? 0
	if (accountStatus !== null && !knownAccountStatuses.has(accountStatus)) {
		onUnknownMetaEnum({ field: 'account_status', value: accountStatus })
	}
	if (disableReason !== 0 && !knownDisableReasons.has(disableReason)) {
		onUnknownMetaEnum({ field: 'disable_reason', value: disableReason })
	}
	if (accountStatus !== 1 && disableReason !== 0) {
		return { color: 'red', reason: { code: 'meta_disabled', disableReason }, needsAttention: true }
	}
	if (accountStatus !== 1) {
		return { color: 'red', reason: { code: 'meta_inactive', accountStatus }, needsAttention: true }
	}
	if (input.isPrepayAccount === false) {
		return { color: 'yellow', reason: { code: 'postpay' }, needsAttention: false }
	}
	return { color: 'green', reason: { code: 'active' }, needsAttention: false }
}

export function signalLaneFor(health: Pick<HealthState, 'color' | 'needsAttention'>): SignalsLane {
	if (health.needsAttention) return 'needs_attention'
	if (health.color === 'yellow') return 'postpay'
	return 'active'
}

export type AccountDateRange = { start: string; end: string }

function localDate(timezoneName: string, now: Date) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: timezoneName,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now)
	const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
	return `${values.year}-${values.month}-${values.day}`
}

function shiftDate(date: string, days: number) {
	const shifted = new Date(`${date}T00:00:00.000Z`)
	shifted.setUTCDate(shifted.getUTCDate() + days)
	return shifted.toISOString().slice(0, 10)
}

function shiftMonth(date: string, months: number) {
	const shifted = new Date(`${date.slice(0, 7)}-01T00:00:00.000Z`)
	shifted.setUTCMonth(shifted.getUTCMonth() + months)
	return shifted.toISOString().slice(0, 10)
}

function startOfMonth(date: string) {
	return `${date.slice(0, 7)}-01`
}

function endOfMonth(date: string) {
	return shiftDate(shiftMonth(startOfMonth(date), 1), -1)
}

// Sunday-anchored week, matching the picker's own week start.
function startOfWeek(date: string) {
	return shiftDate(date, -new Date(`${date}T00:00:00.000Z`).getUTCDay())
}

export function dateRangeForAccount(
	range: TimeRangePreset | AccountDateRange,
	timezoneName: string,
	now = new Date(),
): AccountDateRange {
	if (typeof range === 'object') return range
	const end = localDate(timezoneName, now)
	switch (range) {
		case 'today':
			return { start: end, end }
		case 'yesterday': {
			const yesterday = shiftDate(end, -1)
			return { start: yesterday, end: yesterday }
		}
		case 'last7':
			return { start: shiftDate(end, -6), end }
		case 'last14':
			return { start: shiftDate(end, -13), end }
		case 'last30':
			return { start: shiftDate(end, -29), end }
		case 'thisWeek':
			return { start: startOfWeek(end), end }
		case 'lastWeek': {
			const start = startOfWeek(shiftDate(end, -7))
			return { start, end: shiftDate(start, 6) }
		}
		case 'thisMonth':
			return { start: startOfMonth(end), end }
		case 'lastMonth': {
			const start = startOfMonth(shiftMonth(end, -1))
			return { start, end: endOfMonth(start) }
		}
	}
}

export function reconciliationWindow(timezoneName: string, now = new Date()): AccountDateRange {
	const end = localDate(timezoneName, now)
	return { start: shiftDate(end, -28), end }
}

export function historicalReconciliationRange(timezoneName: string, now = new Date()): AccountDateRange {
	const end = shiftDate(localDate(timezoneName, now), -1)
	return { start: shiftDate(end, -27), end }
}

export function historicalReconciliationRangeForEndDate(end: string): AccountDateRange {
	return { start: shiftDate(end, -27), end }
}

export function firstConnectStart(timezoneName: string, now = new Date()) {
	return shiftDate(localDate(timezoneName, now), -90)
}

export function isProvisional(range: AccountDateRange, timezoneName: string, now = new Date()) {
	const reconciliation = reconciliationWindow(timezoneName, now)
	return range.start <= reconciliation.end && range.end >= reconciliation.start
}

export function isStale(refreshedAt: Date | null, thresholdMilliseconds: number, now = new Date()) {
	return refreshedAt === null || now.getTime() - refreshedAt.getTime() > thresholdMilliseconds
}

type Decimal = { coefficient: bigint; scale: number }

function parseDecimal(value: string): Decimal {
	if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(`Invalid decimal: ${value}`)
	const negative = value.startsWith('-')
	const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
	return { coefficient: (negative ? -1n : 1n) * BigInt(`${whole}${fraction}`), scale: fraction.length }
}

function align(left: Decimal, right: Decimal) {
	const scale = Math.max(left.scale, right.scale)
	return {
		left: left.coefficient * 10n ** BigInt(scale - left.scale),
		right: right.coefficient * 10n ** BigInt(scale - right.scale),
		scale,
	}
}

function addDecimals(left: Decimal, right: Decimal): Decimal {
	const aligned = align(left, right)
	return { coefficient: aligned.left + aligned.right, scale: aligned.scale }
}

function formatDecimal(decimal: Decimal) {
	const negative = decimal.coefficient < 0n ? '-' : ''
	const absolute = (decimal.coefficient < 0n ? -decimal.coefficient : decimal.coefficient)
		.toString()
		.padStart(decimal.scale + 1, '0')
	if (decimal.scale === 0) return `${negative}${absolute}`
	const normalized = `${absolute.slice(0, -decimal.scale)}.${absolute.slice(-decimal.scale)}`
		.replace(/\.0+$/, '')
		.replace(/(\.\d*?)0+$/, '$1')
	return `${negative}${normalized}`
}

export function sumDecimalStrings(values: readonly string[]) {
	return formatDecimal(values.reduce((total, value) => addDecimals(total, parseDecimal(value)), parseDecimal('0')))
}

function divideDecimals(numerator: Decimal, denominator: Decimal, precision = 6) {
	if (denominator.coefficient === 0n) return null
	const sign = numerator.coefficient < 0n === denominator.coefficient < 0n ? 1n : -1n
	const absoluteNumerator = numerator.coefficient < 0n ? -numerator.coefficient : numerator.coefficient
	const absoluteDenominator = denominator.coefficient < 0n ? -denominator.coefficient : denominator.coefficient
	const scaled = absoluteNumerator * 10n ** BigInt(precision + denominator.scale)
	const divisor = absoluteDenominator * 10n ** BigInt(numerator.scale)
	return formatDecimal({ coefficient: sign * (scaled / divisor), scale: precision })
}

export type KpiContribution = {
	spend: string
	impressions: number
	inlineLinkClicks: number
	resultActionType: string | null
	resultCount: string | null
	purchaseValue: string
	running: boolean
}

export type KpiValues = {
	spend: string
	impressions: number
	clicks: number
	ctr: string | null
	cpa: string | null
	cpaReason: CpaReason | null
	results: string | null
	roas: string | null
	running: boolean
}

export function rollupKpis(contributions: readonly KpiContribution[]): KpiValues {
	const totals = contributions.reduce(
		(total, row) => ({
			spend: addDecimals(total.spend, parseDecimal(row.spend)),
			impressions: total.impressions + row.impressions,
			clicks: total.clicks + row.inlineLinkClicks,
			purchaseValue: addDecimals(total.purchaseValue, parseDecimal(row.purchaseValue)),
			running: total.running || row.running,
		}),
		{ spend: parseDecimal('0'), impressions: 0, clicks: 0, purchaseValue: parseDecimal('0'), running: false },
	)
	const spendContributors = contributions.filter(row => parseDecimal(row.spend).coefficient !== 0n)
	const resultActionTypes = new Set(
		spendContributors.flatMap(row => (row.resultActionType ? [row.resultActionType] : [])),
	)
	const hasUnresolvedResult = spendContributors.some(row => row.resultActionType === null || row.resultCount === null)
	const cpaReason: CpaReason | null =
		resultActionTypes.size > 1 ? 'mixed_result_types' : hasUnresolvedResult ? 'unresolved_result_type' : null
	const actionTotal = contributions.reduce(
		(total, row) => addDecimals(total, row.resultCount ? parseDecimal(row.resultCount) : parseDecimal('0')),
		parseDecimal('0'),
	)
	return {
		spend: formatDecimal(totals.spend),
		impressions: totals.impressions,
		clicks: totals.clicks,
		ctr:
			totals.impressions === 0
				? null
				: divideDecimals(parseDecimal(String(totals.clicks)), parseDecimal(String(totals.impressions))),
		cpa: cpaReason ? null : divideDecimals(totals.spend, actionTotal),
		cpaReason,
		// Gated by the same reason as CPA: a mixed or unresolved result type makes the raw count
		// either an apples-to-oranges sum or a silent undercount, so hide it rather than mislead.
		results: cpaReason ? null : formatDecimal(actionTotal),
		roas: divideDecimals(totals.purchaseValue, totals.spend),
		running: totals.running,
	}
}
