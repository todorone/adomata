import { z } from 'zod'

export const fleetBoardMetricKeys = ['spend', 'impressions', 'clicks', 'ctr', 'cpa', 'roas'] as const
export type FleetBoardMetricKey = (typeof fleetBoardMetricKeys)[number]

const defaultMetrics: FleetBoardMetricKey[] = ['spend', 'roas']
const metricSet = new Set<string>(fleetBoardMetricKeys)

export const fleetBoardSearchSchema = z
	.object({
		view: z.enum(['tree', 'control', 'signals']).optional(),
		range: z.enum(['today', 'last7', 'month']).optional(),
		metrics: z.union([z.string(), z.array(z.string())]).optional(),
		group: z.enum(['client', 'flat']).optional(),
		depth: z.enum(['account', 'campaign', 'adset', 'ad']).optional(),
		search: z.string().max(200).optional(),
		needsAttention: z.union([z.enum(['true', 'false']), z.boolean()]).optional(),
		clientId: z.string().max(200).optional(),
		sort: z.enum(['attention', 'name', 'spend', 'impressions', 'clicks', 'ctr', 'cpa', 'roas']).optional(),
		direction: z.enum(['asc', 'desc']).optional(),
		account: z.string().max(200).optional(),
		ad: z.string().max(200).optional(),
	})
	.transform(input => {
		const metricValues = Array.isArray(input.metrics) ? input.metrics : (input.metrics?.split(',') ?? [])
		const metrics = [...new Set(metricValues.filter(metric => metricSet.has(metric)))] as FleetBoardMetricKey[]
		const selectedMetrics = metrics.length > 0 ? metrics : defaultMetrics
		const sort =
			input.sort && input.sort !== 'attention' && input.sort !== 'name' && !selectedMetrics.includes(input.sort)
				? 'attention'
				: (input.sort ?? 'attention')
		return {
			view: input.view ?? 'tree',
			range: input.range ?? 'today',
			metrics: selectedMetrics,
			group: input.group ?? 'client',
			depth: input.depth ?? 'account',
			search: input.search ?? '',
			needsAttention: input.needsAttention === 'true' || input.needsAttention === true,
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
