import { z } from 'zod'

export const accountTierFallbackFields = [
	'id',
	'name',
	'currency',
	'timezone_name',
	'account_status',
	'disable_reason',
	'balance',
] as const

export const accountTierPrepayFields = [...accountTierFallbackFields, 'is_prepay_account'] as const

export const accountTierFields = [...accountTierPrepayFields, 'funding_source_details'] as const

const graphOrigin = 'https://graph.facebook.com'
const graphVersion = 'v25.0'
const hierarchyEffectiveStatuses = [
	'ACTIVE',
	'PAUSED',
	'ARCHIVED',
	'CAMPAIGN_PAUSED',
	'ADSET_PAUSED',
	'PENDING_REVIEW',
	'DISAPPROVED',
	'PREAPPROVED',
	'PENDING_BILLING_INFO',
	'IN_PROCESS',
	'WITH_ISSUES',
]
const maxCreativeVideoSources = 25
const adPreviewFormats = [
	'MOBILE_FEED_STANDARD',
	'INSTAGRAM_STANDARD',
	'INSTAGRAM_REELS',
	'FACEBOOK_STORY_MOBILE',
] as const

const meSchema = z.object({ id: z.string(), name: z.string() })
const actionItemSchema = z.object({ action_type: z.string().min(1), value: z.string().regex(/^-?\d+(?:\.\d+)?$/) })
const accountResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	currency: z.string(),
	timezone_name: z.string().min(1),
	account_status: z.number().int(),
	disable_reason: z.number().int(),
	balance: z.string(),
	is_prepay_account: z.boolean().optional(),
	funding_source_details: z.object({ type: z.number().int() }).nullable().optional(),
})
const campaignSchema = z.object({
	id: z.string(),
	name: z.string(),
	effective_status: z.string(),
	objective: z.string().nullable().optional(),
})
const adSetSchema = z.object({
	id: z.string(),
	campaign_id: z.string(),
	name: z.string(),
	effective_status: z.string(),
	optimization_goal: z.string().nullable().optional(),
	promoted_object: z.record(z.string(), z.unknown()).nullable().optional(),
})
const adSchema = z.object({
	id: z.string(),
	adset_id: z.string(),
	name: z.string(),
	effective_status: z.string(),
})
const adAccountSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	currency: z.string(),
	timezone_name: z.string().nullable().optional(),
	business: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
})
const creativeResponseSchema = z.object({
	id: z.string(),
	name: z.string().nullable().optional(),
	object_story_spec: z.unknown().optional(),
	asset_feed_spec: z.unknown().optional(),
	effective_object_story_id: z.string().optional(),
	effective_instagram_media_id: z.string().optional(),
	thumbnail_url: z.string().url().optional(),
	image_url: z.string().url().optional(),
	video_id: z.string().optional(),
	object_url: z.string().url().optional(),
})
const videoResponseSchema = z.object({ source: z.string().url().optional() })
const adPreviewResponseSchema = z.object({ data: z.array(z.object({ body: z.string() })) })
const adImagesResponseSchema = z.object({
	data: z.array(z.object({ hash: z.string(), url: z.string().url().optional() })),
})
const adResponseSchema = z.object({ id: z.string(), creative: creativeResponseSchema.nullable().optional() })
const insightSchema = z.object({
	ad_id: z.string(),
	date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	spend: z.string().regex(/^-?\d+(?:\.\d+)?$/),
	impressions: z.union([z.number().int(), z.string().regex(/^\d+$/)]),
	inline_link_clicks: z.union([z.number().int(), z.string().regex(/^\d+$/)]).optional(),
	actions: z.array(actionItemSchema).optional(),
	action_values: z.array(actionItemSchema).optional(),
})
const pageSchema = <T extends z.ZodType>(item: T) =>
	z.object({ data: z.array(item), paging: z.object({ next: z.string().url().optional() }).optional() })
const metaErrorSchema = z.object({
	error: z
		.object({
			message: z.string(),
			type: z.string().optional(),
			code: z.number().int().optional(),
			fbtrace_id: z.string().optional(),
		})
		.optional(),
})
const usageSchema = z.object({
	call_count: z.number().optional(),
	total_cputime: z.number().optional(),
	total_time: z.number().optional(),
	estimated_time_to_regain_access: z.number().optional(),
})

export type AccountHealth = {
	id: string
	name: string
	currency: string
	timezoneName: string
	metaAccountStatus: number
	metaDisableReason: number
	balance: string
	isPrepayAccount: boolean | null
	fundingSourceType: number | null
	throttle: MetaThrottleObservation
}

export type MetaCampaign = { id: string; name: string; effectiveStatus: string; objective: string | null }
export type MetaAdSet = {
	id: string
	campaignId: string
	name: string
	effectiveStatus: string
	optimizationGoal: string | null
	resultActionType: string | null
}
export type MetaAd = { id: string; adSetId: string; name: string; effectiveStatus: string }
export type MetaAdAccount = { id: string; name: string; currency: string; timezoneName: string | null }
export type MetaCreative = { id: string; adId: string; name: string | null; payload: Record<string, unknown> }
export type MetaAdPreview = { url: string; width: number | null; height: number | null }
export type MetaAction = z.infer<typeof actionItemSchema>
export type MetaDailyInsight = {
	adId: string
	date: string
	spend: string
	impressions: number
	inlineLinkClicks: number
	actions: MetaAction[]
	actionValues: MetaAction[]
}
export type MetaAppUsage = {
	callCount?: number
	totalCpuTime?: number
	totalTime?: number
	estimatedTimeToRegainAccess?: number
}
export type MetaThrottleObservation = {
	app?: MetaAppUsage
	businessUseCase?: MetaAppUsage
	adAccount?: MetaAppUsage
	insights?: MetaAppUsage
	exhausted: boolean
}
export type MetaPageResult<T> = { items: T[]; throttle: MetaThrottleObservation }

export class MetaApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: number,
		readonly type?: string,
		readonly fbtraceId?: string,
		readonly appUsage?: MetaAppUsage,
		readonly throttle?: MetaThrottleObservation,
	) {
		super(message)
		this.name = 'MetaApiError'
	}
}

type MetaClientOptions = {
	accessToken: string
	fetch?: (input: string) => Promise<Response>
	sleep?: (milliseconds: number) => Promise<void>
}

export function formatAdAccountId(adAccountId: string) {
	return adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`
}

export class MetaClient {
	private readonly fetch: (input: string) => Promise<Response>
	private readonly sleep: (milliseconds: number) => Promise<void>

	constructor(private readonly options: MetaClientOptions) {
		this.fetch = options.fetch ?? (input => fetch(input))
		this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
	}

	async verifyToken(): Promise<{ id: string; name: string }> {
		const url = this.graphUrl('/me')
		url.searchParams.set('fields', 'id,name')
		const { payload } = await this.request(url)
		return meSchema.parse(payload)
	}

	async getAccount(adAccountId: string): Promise<AccountHealth> {
		const url = this.graphUrl(`/${formatAdAccountId(adAccountId)}`)
		url.searchParams.set('fields', accountTierFields.join(','))
		try {
			const { payload, throttle } = await this.request(url)
			return normalizeAccount(payload, throttle)
		} catch (error) {
			if (!(error instanceof MetaApiError) || error.code !== 10) throw error
			url.searchParams.set('fields', accountTierPrepayFields.join(','))
			try {
				const { payload, throttle } = await this.request(url)
				return normalizeAccount(payload, throttle)
			} catch (fallbackError) {
				if (!(fallbackError instanceof MetaApiError) || fallbackError.code !== 10) throw fallbackError
				url.searchParams.set('fields', accountTierFallbackFields.join(','))
				const { payload, throttle } = await this.request(url)
				return normalizeAccount(payload, throttle)
			}
		}
	}

	listCampaigns(adAccountId: string) {
		return this.listPage(
			`/` + formatAdAccountId(adAccountId) + '/campaigns',
			'id,name,effective_status,objective',
			campaignSchema,
			campaign => ({
				id: campaign.id,
				name: campaign.name,
				effectiveStatus: campaign.effective_status,
				objective: campaign.objective ?? null,
			}),
			{ effective_status: JSON.stringify(hierarchyEffectiveStatuses) },
		)
	}

	listAdSets(adAccountId: string) {
		return this.listPage(
			`/${formatAdAccountId(adAccountId)}/adsets`,
			'id,campaign_id,name,effective_status,optimization_goal,promoted_object',
			adSetSchema,
			adSet => ({
				id: adSet.id,
				campaignId: adSet.campaign_id,
				name: adSet.name,
				effectiveStatus: adSet.effective_status,
				optimizationGoal: adSet.optimization_goal ?? null,
				resultActionType: resolveResultActionType(adSet.optimization_goal ?? null, adSet.promoted_object ?? null),
			}),
			{ effective_status: JSON.stringify(hierarchyEffectiveStatuses) },
		)
	}

	listAds(adAccountId: string) {
		return this.listPage(
			`/` + formatAdAccountId(adAccountId) + '/ads',
			'id,adset_id,name,effective_status',
			adSchema,
			ad => ({
				id: ad.id,
				adSetId: ad.adset_id,
				name: ad.name,
				effectiveStatus: ad.effective_status,
			}),
			{ effective_status: JSON.stringify(hierarchyEffectiveStatuses) },
		)
	}

	listAdAccounts() {
		return this.listPage(
			'/me/adaccounts',
			'id,name,currency,timezone_name,business{id,name}',
			adAccountSummarySchema,
			account => ({
				id: formatAdAccountId(account.id),
				name: account.name,
				currency: account.currency,
				timezoneName: account.timezone_name ?? null,
				businessId: account.business?.id ?? null,
				businessName: account.business?.name ?? null,
			}),
		)
	}

	async getCreative(adId: string, adAccountId?: string): Promise<MetaCreative | null> {
		const url = this.graphUrl(`/${adId}`)
		url.searchParams.set(
			'fields',
			'creative{id,name,object_story_spec,asset_feed_spec,effective_object_story_id,effective_instagram_media_id,thumbnail_url,image_url,video_id,object_url}',
		)
		const { payload } = await this.request(url)
		const ad = adResponseSchema.parse(payload)
		if (!ad.creative) return null
		const { id, name, ...payloadFields } = ad.creative
		const primaryVideoId = metaVideoId(ad.creative.video_id)
		const videoIds = [...(primaryVideoId ? [primaryVideoId] : []), ...assetFeedVideoIds(ad.creative.asset_feed_spec)]
		const videoSources = new Map(
			await Promise.all(
				[...new Set(videoIds)]
					.slice(0, maxCreativeVideoSources)
					.map(async videoId => [videoId, await this.getVideoSource(videoId)] as const),
			),
		)
		const assetFeedWithVideos = addAssetFeedVideoSources(ad.creative.asset_feed_spec, videoSources)
		const assetFeed = assetFeedWithVideos ?? ad.creative.asset_feed_spec
		const imageHashes = assetFeedImageHashes(assetFeed)
		const imageUrls = adAccountId ? await this.getAdImageUrls(adAccountId, imageHashes) : new Map<string, string>()
		const assetFeedWithImages = addAssetFeedImageSources(assetFeed, imageUrls)
		const videoUrl = primaryVideoId ? videoSources.get(primaryVideoId) : null
		return {
			id,
			adId: ad.id,
			name: name ?? null,
			payload: {
				...payloadFields,
				...(videoUrl ? { video_url: videoUrl } : {}),
				...(assetFeedWithImages ? { asset_feed_spec: assetFeedWithImages } : {}),
			},
		}
	}

	async getAdPreview(adId: string): Promise<MetaAdPreview | null> {
		for (const adFormat of adPreviewFormats) {
			const preview = await this.getAdPreviewIn(adId, adFormat)
			if (preview) return preview
		}
		return null
	}

	private async getAdPreviewIn(adId: string, adFormat: string) {
		try {
			const url = this.graphUrl(`/${encodeURIComponent(adId)}/previews`)
			url.searchParams.set('ad_format', adFormat)
			const { payload } = await this.request(url)
			const body = adPreviewResponseSchema.parse(payload).data[0]?.body
			return body ? parseAdPreview(body) : null
		} catch (error) {
			if (error instanceof MetaApiError) return null
			throw error
		}
	}

	async listDailyInsights(
		adAccountId: string,
		range: { start: string; end: string },
	): Promise<MetaPageResult<MetaDailyInsight>> {
		const url = this.graphUrl(`/${formatAdAccountId(adAccountId)}/insights`)
		url.searchParams.set('level', 'ad')
		url.searchParams.set('time_increment', '1')
		url.searchParams.set('time_range', JSON.stringify({ since: range.start, until: range.end }))
		url.searchParams.set('fields', 'ad_id,date_start,spend,impressions,inline_link_clicks,actions,action_values')
		return this.collectPages(url, insightSchema, row => ({
			adId: row.ad_id,
			date: row.date_start,
			spend: row.spend,
			impressions: Number(row.impressions),
			inlineLinkClicks: Number(row.inline_link_clicks ?? 0),
			actions: row.actions ?? [],
			actionValues: row.action_values ?? [],
		}))
	}

	private async listPage<T extends z.ZodType, U>(
		path: string,
		fields: string,
		schema: T,
		normalize: (value: z.output<T>) => U,
		params: Record<string, string> = {},
	) {
		const url = this.graphUrl(path)
		url.searchParams.set('fields', fields)
		for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
		return this.collectPages(url, schema, normalize)
	}

	private async collectPages<T extends z.ZodType, U>(
		firstUrl: URL,
		schema: T,
		normalize: (value: z.output<T>) => U,
	): Promise<MetaPageResult<U>> {
		let nextUrl: URL | undefined = firstUrl
		const items: U[] = []
		let throttle: MetaThrottleObservation = { exhausted: false }
		while (nextUrl) {
			const { payload, throttle: pageThrottle } = await this.request(nextUrl)
			const page = pageSchema(schema).parse(payload)
			items.push(...page.data.map(normalize))
			throttle = mergeThrottle(throttle, pageThrottle)
			nextUrl = page.paging?.next ? this.safeCursor(page.paging.next) : undefined
		}
		return { items, throttle }
	}

	private graphUrl(path: string) {
		const url = new URL(`/${graphVersion}${path}`, graphOrigin)
		url.searchParams.set('access_token', this.options.accessToken)
		return url
	}

	private async getVideoSource(videoId: string) {
		try {
			const url = this.graphUrl(`/${encodeURIComponent(videoId)}`)
			url.searchParams.set('fields', 'source')
			const { payload } = await this.request(url)
			return videoResponseSchema.parse(payload).source ?? null
		} catch {
			// The thumbnail remains useful when the token cannot read the video source.
			return null
		}
	}

	private async getAdImageUrls(adAccountId: string, hashes: string[]) {
		if (hashes.length === 0) return new Map<string, string>()
		try {
			const url = this.graphUrl(`/${formatAdAccountId(adAccountId)}/adimages`)
			url.searchParams.set('fields', 'hash,url')
			url.searchParams.set('hashes', JSON.stringify(hashes))
			const { payload } = await this.request(url)
			return new Map(
				adImagesResponseSchema
					.parse(payload)
					.data.flatMap(image => (image.url ? ([[image.hash, image.url]] as const) : [])),
			)
		} catch {
			// A missing image-library permission should not make the whole creative unavailable.
			return new Map<string, string>()
		}
	}

	private safeCursor(cursor: string) {
		const url = new URL(cursor)
		if (
			url.protocol !== 'https:' ||
			url.hostname !== 'graph.facebook.com' ||
			!url.pathname.startsWith(`/${graphVersion}/`)
		) {
			throw new Error('Meta pagination cursor has an untrusted host or path')
		}
		return url
	}

	private async request(url: URL): Promise<{ payload: unknown; throttle: MetaThrottleObservation }> {
		let lastError: MetaApiError | undefined
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				const response = await this.fetch(url.toString())
				if (response.ok) return { payload: await response.json(), throttle: parseThrottle(response.headers) }
				lastError = await parseMetaError(response)
				if (!isRetryable(lastError) || attempt === 2) throw lastError
			} catch (error) {
				if (!(error instanceof MetaApiError)) throw error
				lastError = error
				if (!isRetryable(error) || attempt === 2) throw error
			}
			await this.sleep(1000 * 2 ** attempt)
		}
		throw lastError ?? new Error('Meta request failed without an error')
	}
}

function normalizeAccount(payload: unknown, throttle: MetaThrottleObservation): AccountHealth {
	const account = accountResponseSchema.parse(payload)
	return {
		id: formatAdAccountId(account.id),
		name: account.name,
		currency: account.currency,
		timezoneName: account.timezone_name,
		metaAccountStatus: account.account_status,
		metaDisableReason: account.disable_reason,
		balance: account.balance,
		isPrepayAccount: account.is_prepay_account ?? null,
		fundingSourceType: account.funding_source_details?.type ?? null,
		throttle,
	}
}

function assetFeedVideoIds(assetFeed: unknown) {
	if (!assetFeed || typeof assetFeed !== 'object' || Array.isArray(assetFeed)) return []
	const videos = (assetFeed as Record<string, unknown>).videos
	if (!Array.isArray(videos)) return []
	return videos.flatMap(video => {
		if (!video || typeof video !== 'object' || Array.isArray(video)) return []
		const videoId = metaVideoId((video as Record<string, unknown>).video_id)
		return videoId ? [videoId] : []
	})
}

function assetFeedImageHashes(assetFeed: unknown) {
	if (!assetFeed || typeof assetFeed !== 'object' || Array.isArray(assetFeed)) return []
	const images = (assetFeed as Record<string, unknown>).images
	if (!Array.isArray(images)) return []
	return images.flatMap(image => {
		if (!image || typeof image !== 'object' || Array.isArray(image)) return []
		const hash = (image as Record<string, unknown>).hash
		return typeof hash === 'string' && hash.length > 0 ? [hash] : []
	})
}

function addAssetFeedVideoSources(assetFeed: unknown, videoSources: Map<string, string | null>) {
	if (!assetFeed || typeof assetFeed !== 'object' || Array.isArray(assetFeed)) return null
	const record = assetFeed as Record<string, unknown>
	if (!Array.isArray(record.videos)) return null
	return {
		...record,
		videos: record.videos.map(video => {
			if (!video || typeof video !== 'object' || Array.isArray(video)) return video
			const videoId = metaVideoId((video as Record<string, unknown>).video_id)
			const source = videoId ? videoSources.get(videoId) : null
			return source ? { ...video, video_url: source } : video
		}),
	}
}

function addAssetFeedImageSources(assetFeed: unknown, imageUrls: Map<string, string>) {
	if (!assetFeed || typeof assetFeed !== 'object' || Array.isArray(assetFeed)) return null
	const record = assetFeed as Record<string, unknown>
	if (!Array.isArray(record.images)) return assetFeed
	return {
		...record,
		images: record.images.map(image => {
			if (!image || typeof image !== 'object' || Array.isArray(image)) return image
			const imageRecord = image as Record<string, unknown>
			const hash = imageRecord.hash
			const url = typeof hash === 'string' ? imageUrls.get(hash) : undefined
			return url ? { ...imageRecord, url } : image
		}),
	}
}

function metaVideoId(value: unknown) {
	return typeof value === 'string' && /^\d{1,30}$/.test(value) ? value : null
}

function iframeAttribute(markup: string, name: string) {
	return new RegExp(`<iframe[^>]*\\s${name}="([^"]*)"`, 'i').exec(markup)?.[1] ?? null
}

function iframeDimension(markup: string, name: string) {
	const value = Number(iframeAttribute(markup, name))
	return Number.isInteger(value) && value > 0 ? value : null
}

function parseAdPreview(markup: string): MetaAdPreview | null {
	const src = iframeAttribute(markup, 'src')?.replaceAll('&amp;', '&')
	if (!src) return null
	let url: URL
	try {
		url = new URL(src)
	} catch {
		return null
	}
	if (url.protocol !== 'https:' || (url.hostname !== 'facebook.com' && !url.hostname.endsWith('.facebook.com'))) {
		return null
	}
	return { url: url.toString(), width: iframeDimension(markup, 'width'), height: iframeDimension(markup, 'height') }
}

function resolveResultActionType(optimizationGoal: string | null, promotedObject: Record<string, unknown> | null) {
	if (typeof promotedObject?.custom_event_type === 'string') return promotedObject.custom_event_type.toLowerCase()
	if (
		optimizationGoal === 'LEAD_GENERATION' ||
		optimizationGoal === 'OFFSITE_CONVERSIONS_LEADS' ||
		optimizationGoal === 'QUALITY_LEAD'
	)
		return 'lead'
	if (optimizationGoal === 'OFFSITE_CONVERSIONS' || optimizationGoal === 'VALUE' || optimizationGoal === 'PURCHASE')
		return 'purchase'
	if (optimizationGoal === 'LINK_CLICKS') return 'link_click'
	return null
}

async function parseMetaError(response: Response): Promise<MetaApiError> {
	let payload: unknown
	try {
		payload = await response.json()
	} catch {
		payload = undefined
	}
	const parsed = metaErrorSchema.safeParse(payload)
	const error = parsed.success ? parsed.data.error : undefined
	const throttle = parseThrottle(response.headers)
	return new MetaApiError(
		error?.message ?? `Meta Graph API request failed with HTTP ${response.status}`,
		response.status,
		error?.code,
		error?.type,
		error?.fbtrace_id,
		throttle.app,
		throttle,
	)
}

function parseUsage(header: string | null): MetaAppUsage | undefined {
	if (!header) return undefined
	try {
		const usage = usageSchema.parse(JSON.parse(header))
		return {
			callCount: usage.call_count,
			totalCpuTime: usage.total_cputime,
			totalTime: usage.total_time,
			estimatedTimeToRegainAccess: usage.estimated_time_to_regain_access,
		}
	} catch {
		return undefined
	}
}

function parseBusinessUseCaseUsage(header: string | null) {
	if (!header) return undefined
	try {
		const parsed = z.record(z.string(), z.array(usageSchema)).parse(JSON.parse(header))
		return Object.values(parsed).flat()[0]
	} catch {
		return undefined
	}
}

function parseThrottle(headers: Headers): MetaThrottleObservation {
	const app = parseUsage(headers.get('x-app-usage'))
	const businessUseCase = parseBusinessUseCaseUsage(headers.get('x-business-use-case-usage'))
	const adAccount = parseUsage(headers.get('x-ad-account-usage'))
	const insights = parseUsage(headers.get('x-insights-usage'))
	const normalizedBusinessUseCase = businessUseCase
		? {
				callCount: businessUseCase.call_count,
				totalCpuTime: businessUseCase.total_cputime,
				totalTime: businessUseCase.total_time,
				estimatedTimeToRegainAccess: businessUseCase.estimated_time_to_regain_access,
			}
		: undefined
	const all = [app, normalizedBusinessUseCase, adAccount, insights]
	return {
		app,
		businessUseCase: normalizedBusinessUseCase,
		adAccount,
		insights,
		exhausted: all.some(
			usage => (usage?.callCount ?? 0) >= 100 || (usage?.totalCpuTime ?? 0) >= 100 || (usage?.totalTime ?? 0) >= 100,
		),
	}
}

function mergeThrottle(left: MetaThrottleObservation, right: MetaThrottleObservation): MetaThrottleObservation {
	return {
		app: right.app ?? left.app,
		businessUseCase: right.businessUseCase ?? left.businessUseCase,
		adAccount: right.adAccount ?? left.adAccount,
		insights: right.insights ?? left.insights,
		exhausted: left.exhausted || right.exhausted,
	}
}

function isRetryable(error: MetaApiError) {
	return error.code === 4 || error.status === 429 || error.status >= 500
}
