import { z } from 'zod'

const nullableIsoDateTimeSchema = z.string().datetime({ offset: true }).nullable()

export const fleetBoardRangeSchema = z.enum(['today', 'last7', 'month'])
export const fleetBoardSortSchema = z.enum([
	'attention',
	'name',
	'spend',
	'impressions',
	'clicks',
	'ctr',
	'cpa',
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
	z.object({ code: z.literal('client_attention'), count: z.number().int(), total: z.number().int() }),
	z.object({ code: z.literal('client_postpay'), count: z.number().int() }),
	z.object({ code: z.literal('client_active'), count: z.number().int() }),
	z.object({ code: z.literal('client_awaiting_data'), count: z.number().int() }),
])

export const fleetBoardKpisSchema = z.object({
	spend: z.string().nullable(),
	impressions: z.number().int(),
	clicks: z.number().int(),
	ctr: z.string().nullable(),
	cpa: z.string().nullable(),
	cpaReason: fleetBoardCpaReasonSchema.nullable(),
	roas: z.string().nullable(),
	running: z.boolean(),
	unsupported: z.literal('mixed_currency').nullable(),
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

export const fleetBoardHierarchyNodeSchema = z.object({
	id: z.string(),
	type: z.enum(['campaign', 'adset', 'ad']),
	parentId: z.string(),
	name: z.string(),
	effectiveStatus: z.string(),
	kpis: fleetBoardKpisSchema,
})

export const fleetBoardClientSchema = z.object({
	id: z.string(),
	name: z.string(),
	currency: z.string().nullable(),
	mixedCurrency: z.boolean(),
	mixedTimezone: z.boolean(),
	health: z.object({
		color: fleetBoardHealthColorSchema,
		reason: fleetBoardHealthReasonSchema,
		needsAttention: z.boolean(),
	}),
	signalsLane: fleetBoardSignalsLaneSchema,
	kpis: fleetBoardKpisSchema,
	accountIds: z.array(z.string()),
})

export const fleetBoardRootQuerySchema = z.object({
	range: fleetBoardRangeSchema.optional().default('today'),
	search: z.string().trim().max(200).optional().default(''),
	needsAttention: z
		.enum(['true', 'false'])
		.optional()
		.transform(value => value === 'true'),
	clientId: z.string().min(1).max(200).optional(),
	sort: fleetBoardSortSchema.optional().default('attention'),
	direction: fleetBoardDirectionSchema.optional().default('desc'),
})

export const fleetBoardRootResponseSchema = z.object({
	clients: z.array(fleetBoardClientSchema),
	accounts: z.array(fleetBoardAccountSchema),
	header: z.object({
		accountTierRefreshedAt: nullableIsoDateTimeSchema,
		insightsTierRefreshedAt: nullableIsoDateTimeSchema,
		accountTierStale: z.boolean(),
		insightsTierStale: z.boolean(),
		provisional: z.boolean(),
	}),
})

export const fleetBoardHierarchyQuerySchema = z.object({
	range: fleetBoardRangeSchema.optional().default('today'),
	parents: z
		.string()
		.max(10_000)
		.transform((value, context) => {
			try {
				return JSON.parse(value) as unknown
			} catch {
				context.addIssue({ code: 'custom', message: 'parents must be JSON' })
				return z.NEVER
			}
		})
		.pipe(
			z
				.array(z.object({ type: z.enum(['account', 'campaign', 'adset']), id: z.string().min(1).max(200) }))
				.min(1)
				.max(50)
				.superRefine((parents, context) => {
					const duplicate = parents.find(
						(parent, index) =>
							parents.findIndex(candidate => candidate.type === parent.type && candidate.id === parent.id) !==
							index,
					)
					if (duplicate)
						context.addIssue({ code: 'custom', message: `Duplicate parent: ${duplicate.type}/${duplicate.id}` })
				}),
		),
})

export const fleetBoardHierarchyResponseSchema = z.object({ nodes: z.array(fleetBoardHierarchyNodeSchema) })

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

export type FleetBoardRange = z.infer<typeof fleetBoardRangeSchema>
export type FleetBoardRootQuery = z.infer<typeof fleetBoardRootQuerySchema>
export type FleetBoardRootResponse = z.infer<typeof fleetBoardRootResponseSchema>
export type FleetBoardHierarchyResponse = z.infer<typeof fleetBoardHierarchyResponseSchema>
export type FleetBoardCreativeResponse = z.infer<typeof fleetBoardCreativeResponseSchema>
