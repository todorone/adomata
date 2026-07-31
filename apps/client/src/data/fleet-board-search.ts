import { z } from 'zod'

export const fleetBoardMetricKeys = ['spend', 'impressions', 'clicks', 'ctr', 'cpa', 'roas'] as const
export type FleetBoardMetricKey = (typeof fleetBoardMetricKeys)[number]

// Spend + Clicks + CPA rather than Spend + ROAS: a lead-generation fleet records no purchase
// value, so ROAS as a default column made a working board open as a wall of zeroes.
const defaultMetrics: FleetBoardMetricKey[] = ['spend', 'clicks', 'cpa']
const metricSet = new Set<string>(fleetBoardMetricKeys)
const nonMetricSorts = new Set(['attention', 'name', 'owed'])

const rangePresetSchema = z.enum([
	'today',
	'last7',
	'last14',
	'last30',
	'thisWeek',
	'lastWeek',
	'thisMonth',
	'lastMonth',
])
const customRangeSchema = z.object({
	start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const fleetBoardSearchSchema = z
	.object({
		view: z.enum(['tree', 'control', 'signals']).optional(),
		range: z.union([rangePresetSchema, customRangeSchema]).optional(),
		metrics: z.union([z.string(), z.array(z.string())]).optional(),
		group: z.enum(['client', 'flat']).optional(),
		depth: z.enum(['account', 'campaign', 'adset', 'ad']).optional(),
		search: z.string().max(200).optional(),
		needsAttention: z.union([z.enum(['true', 'false']), z.boolean()]).optional(),
		hidePaused: z.union([z.enum(['true', 'false']), z.boolean()]).optional(),
		clientId: z.string().max(200).optional(),
		sort: z.enum(['attention', 'name', 'owed', 'spend', 'impressions', 'clicks', 'ctr', 'cpa', 'roas']).optional(),
		direction: z.enum(['asc', 'desc']).optional(),
		account: z.string().max(200).optional(),
		ad: z.string().max(200).optional(),
	})
	.transform(input => {
		const metricValues = Array.isArray(input.metrics) ? input.metrics : (input.metrics?.split(',') ?? [])
		const metrics = [...new Set(metricValues.filter(metric => metricSet.has(metric)))] as FleetBoardMetricKey[]
		const selectedMetrics = metrics.length > 0 ? metrics : defaultMetrics
		const sort =
			input.sort && !nonMetricSorts.has(input.sort) && !selectedMetrics.includes(input.sort as FleetBoardMetricKey)
				? 'attention'
				: (input.sort ?? 'attention')
		return {
			view: input.view ?? 'tree',
			// Last 7 days rather than Today: opening the board in the morning showed a column
			// of 0,00 for a fleet that was in fact spending.
			range: input.range ?? 'last7',
			metrics: selectedMetrics,
			group: input.group ?? 'client',
			depth: input.depth ?? 'account',
			search: input.search ?? '',
			needsAttention: input.needsAttention === 'true' || input.needsAttention === true,
			hidePaused: input.hidePaused === 'true' || input.hidePaused === true,
			...(input.clientId ? { clientId: input.clientId } : {}),
			sort,
			direction: input.direction ?? 'desc',
			...(input.account ? { account: input.account } : {}),
			...(input.ad ? { ad: input.ad } : {}),
		}
	})

export type FleetBoardSearch = z.infer<typeof fleetBoardSearchSchema>

export function metricsSearchValue(metrics: FleetBoardMetricKey[]) {
	return metrics.join(',')
}
