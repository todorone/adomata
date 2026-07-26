import { z } from 'zod'

export const accountTierFields = [
	'id',
	'name',
	'currency',
	'account_status',
	'disable_reason',
	'balance',
	'is_prepay_account',
	'funding_source_details',
] as const

const accountResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	currency: z.string(),
	account_status: z.number().int(),
	disable_reason: z.number().int(),
	balance: z.string(),
	is_prepay_account: z.boolean(),
	funding_source_details: z.object({ type: z.number().int() }).nullable().optional(),
})

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

export type AccountHealth = {
	id: string
	name: string
	currency: string
	metaAccountStatus: number
	metaDisableReason: number
	balance: string
	isPrepayAccount: boolean
	fundingSourceType: number | null
}

export type MetaAppUsage = {
	callCount?: number
	totalCpuTime?: number
	totalTime?: number
}

export class MetaApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: number,
		readonly type?: string,
		readonly fbtraceId?: string,
		readonly appUsage?: MetaAppUsage,
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

export class MetaClient {
	private readonly fetch: (input: string) => Promise<Response>
	private readonly sleep: (milliseconds: number) => Promise<void>

	constructor(private readonly options: MetaClientOptions) {
		this.fetch = options.fetch ?? (input => fetch(input))
		this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
	}

	async getAccount(adAccountId: string): Promise<AccountHealth> {
		const url = new URL(`https://graph.facebook.com/v25.0/act_${adAccountId}`)
		url.searchParams.set('fields', accountTierFields.join(','))
		url.searchParams.set('access_token', this.options.accessToken)

		let lastError: MetaApiError | undefined
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				const response = await this.fetch(url.toString())
				if (response.ok) return normalizeAccount(await response.json())

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

function normalizeAccount(payload: unknown): AccountHealth {
	const account = accountResponseSchema.parse(payload)
	return {
		id: account.id,
		name: account.name,
		currency: account.currency,
		metaAccountStatus: account.account_status,
		metaDisableReason: account.disable_reason,
		balance: account.balance,
		isPrepayAccount: account.is_prepay_account,
		fundingSourceType: account.funding_source_details?.type ?? null,
	}
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
	return new MetaApiError(
		error?.message ?? `Meta Graph API request failed with HTTP ${response.status}`,
		response.status,
		error?.code,
		error?.type,
		error?.fbtrace_id,
		parseAppUsage(response.headers.get('x-app-usage')),
	)
}

function parseAppUsage(header: string | null): MetaAppUsage | undefined {
	if (!header) return undefined
	try {
		const usage = z
			.object({
				call_count: z.number().optional(),
				total_cputime: z.number().optional(),
				total_time: z.number().optional(),
			})
			.parse(JSON.parse(header))
		return { callCount: usage.call_count, totalCpuTime: usage.total_cputime, totalTime: usage.total_time }
	} catch {
		return undefined
	}
}

function isRetryable(error: MetaApiError) {
	return error.code === 4 || error.status === 429 || error.status >= 500
}
