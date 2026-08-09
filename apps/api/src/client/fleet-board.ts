import { z } from 'zod'

const nullableIsoDateTimeSchema = z.string().datetime({ offset: true }).nullable()
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

export const fleetBoardRangePresetSchema = z.enum([
	'today',
	'yesterday',
	'last7',
	'last14',
	'last30',
	'thisWeek',
	'lastWeek',
	'thisMonth',
	'lastMonth',
	'custom',
])

// A 'custom' preset carries its own from/to instead of resolving relative to `now`.
function resolveRange(
	input: { range: z.infer<typeof fleetBoardRangePresetSchema>; from?: string; to?: string },
	context: z.RefinementCtx,
) {
	if (input.range !== 'custom') return input.range
	if (!input.from || !input.to) {
		context.addIssue({ code: 'custom', message: 'from and to are required when range is custom', path: ['from'] })
		return z.NEVER
	}
	if (input.from > input.to) {
		context.addIssue({ code: 'custom', message: 'from must not be after to', path: ['to'] })
		return z.NEVER
	}
	return { start: input.from, end: input.to }
}

export const fleetBoardSortSchema = z.enum([
	'attention',
	'name',
	'owed',
	'spend',
	'impressions',
	'clicks',
	'ctr',
	'cpa',
	'results',
	'roas',
])
export const fleetBoardDirectionSchema = z.enum(['asc', 'desc'])
export const fleetBoardNodeTypeSchema = z.enum(['account', 'campaign', 'adset', 'ad'])
export const fleetBoardHealthColorSchema = z.enum(['green', 'yellow', 'red', 'grey'])
export const fleetBoardSignalsLaneSchema = z.enum(['needs_attention', 'postpay', 'active', 'awaiting_data'])
export const fleetBoardCpaReasonSchema = z.enum(['mixed_result_types', 'unresolved_result_type'])

export const fleetBoardHealthReasonSchema = z.discriminatedUnion('code', [
	z.object({ code: z.literal('connection_pending') }),
	z.object({ code: z.literal('connection_access_lost') }),
	z.object({ code: z.literal('meta_disabled'), disableReason: z.number().int() }),
	z.object({ code: z.literal('meta_inactive'), accountStatus: z.number().int().nullable() }),
	z.object({ code: z.literal('postpay') }),
	z.object({ code: z.literal('active') }),
])

export const fleetBoardKpisSchema = z.object({
	spend: z.string().nullable(),
	impressions: z.number().int(),
	clicks: z.number().int(),
	ctr: z.string().nullable(),
	cpa: z.string().nullable(),
	cpaReason: fleetBoardCpaReasonSchema.nullable(),
	results: z.string().nullable(),
	roas: z.string().nullable(),
	running: z.boolean(),
})

const freshnessSchema = z.object({
	refreshedAt: nullableIsoDateTimeSchema,
	stale: z.boolean(),
	failed: z.boolean(),
})

export const fleetBoardAccountSchema = z.object({
	id: z.string(),
	type: z.literal('account'),
	clientId: z.string(),
	clientName: z.string(),
	name: z.string(),
	currency: z.string(),
	timezoneName: z.string(),
	amountOwed: z.string().nullable(),
	connectionStatus: z.enum(['pending', 'connected', 'access_lost']),
	health: z.object({
		color: fleetBoardHealthColorSchema,
		reason: fleetBoardHealthReasonSchema,
		needsAttention: z.boolean(),
	}),
	signalsLane: fleetBoardSignalsLaneSchema,
	kpis: fleetBoardKpisSchema,
	freshness: z.object({ accountTier: freshnessSchema, insightsTier: freshnessSchema }),
})

export const fleetBoardNodeSchema = z.object({
	id: z.string(),
	type: z.enum(['campaign', 'adset', 'ad']),
	parentId: z.string(),
	name: z.string(),
	effectiveStatus: z.string(),
	kpis: fleetBoardKpisSchema,
	creativeId: z.string().nullable(),
	creativeHasVideo: z.boolean(),
})

export const fleetBoardClientSchema = z.object({
	id: z.string(),
	name: z.string(),
})

export const fleetBoardRootQuerySchema = z
	.object({
		// Mirrors the client's Time Range default (spec §5) so a caller that omits the parameter
		// gets the same period the board shows.
		range: fleetBoardRangePresetSchema.optional().default('last7'),
		from: isoDateSchema.optional(),
		to: isoDateSchema.optional(),
		search: z.string().trim().max(200).optional().default(''),
		needsAttention: z
			.enum(['true', 'false'])
			.optional()
			.transform(value => value === 'true'),
		clientId: z.string().min(1).max(200).optional(),
		sort: fleetBoardSortSchema.optional().default('attention'),
		direction: fleetBoardDirectionSchema.optional().default('desc'),
	})
	.transform(({ from, to, ...rest }, context) => ({
		...rest,
		range: resolveRange({ range: rest.range, from, to }, context),
	}))

export const fleetBoardRootResponseSchema = z.object({
	clients: z.array(fleetBoardClientSchema),
	accounts: z.array(fleetBoardAccountSchema),
	nodes: z.array(fleetBoardNodeSchema),
	header: z.object({
		accountTierRefreshedAt: nullableIsoDateTimeSchema,
		insightsTierRefreshedAt: nullableIsoDateTimeSchema,
		accountTierStale: z.boolean(),
		insightsTierStale: z.boolean(),
		// Visible Ad Accounts with no successful refresh for the tier — reported as their own
		// fact so «ще не синхронізовано» never stands in for the whole fleet.
		accountTierNeverSynced: z.number().int(),
		insightsTierNeverSynced: z.number().int(),
		provisional: z.boolean(),
	}),
})

export const fleetBoardCreativeAssetSchema = z.object({
	key: z.string(),
	kind: z.enum(['image', 'video', 'text', 'link', 'cta', 'placement']),
	label: z.string(),
	value: z.string().nullable(),
	mediaKey: z.string().nullable(),
})
export const fleetBoardCreativeResponseSchema = z.object({
	id: z.string(),
	adId: z.string(),
	name: z.string().nullable(),
	kind: z.enum(['image', 'video', 'carousel', 'asset_feed', 'existing_post', 'unknown']),
	body: z.string().nullable(),
	headline: z.string().nullable(),
	description: z.string().nullable(),
	callToAction: z.string().nullable(),
	destination: z.string().url().nullable(),
	existingPostId: z.string().nullable(),
	assets: z.array(fleetBoardCreativeAssetSchema),
	mediaUnavailable: z.boolean(),
})

export type FleetBoardRangePreset = z.infer<typeof fleetBoardRangePresetSchema>
export type FleetBoardCustomRange = { start: string; end: string }
export type FleetBoardRange = Exclude<FleetBoardRangePreset, 'custom'> | FleetBoardCustomRange
export type FleetBoardRootQuery = z.infer<typeof fleetBoardRootQuerySchema>
export type FleetBoardRootResponse = z.infer<typeof fleetBoardRootResponseSchema>
export type FleetBoardNode = z.infer<typeof fleetBoardNodeSchema>
export type FleetBoardCreativeResponse = z.infer<typeof fleetBoardCreativeResponseSchema>
