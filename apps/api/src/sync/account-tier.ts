import { and, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'

import { db } from '../db'
import { ad, adAccount, adCreative, adInsight, adSet, campaign, client, organizationSettings } from '../db/schema'
import { firstConnectStart, reconciliationWindow } from '../fleet-board/domain'
import { logger } from '../core/logger'
import { MetaApiError } from '../meta/client'
import type { MetaClient, MetaDailyInsight } from '../meta/client'

export const accountTierAdvisoryLock = 190019
export const insightsTierAdvisoryLock = 190020
const accountTierIntervalMilliseconds = 5 * 60 * 1000
const insightsTierIntervalMilliseconds = 60 * 60 * 1000
const accountTierConcurrency = 3
const insightsTierConcurrency = 2
const noTokenMessage = 'No Meta token configured for this Agency'

type TierCounts = { processed: number; failed: number; skipped: number; skippedNoToken: number }
export type HeartbeatResult = { accountTier: TierCounts; insightsTier: TierCounts }

type RunHeartbeatOptions = {
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now?: Date
}

export async function runHeartbeat({
	metaMode,
	buildMetaClient,
	now = new Date(),
}: RunHeartbeatOptions): Promise<HeartbeatResult> {
	const accountTier = await runAccountTier(metaMode, buildMetaClient, now)
	const insightsTier = await runInsightsTier(metaMode, buildMetaClient, now)
	return { accountTier, insightsTier }
}

// Fake mode never involves organizationSettings (ADR 0028) — the plain adAccount
// query keeps its existing shape and buildMetaClient ignores the null token.
// Live mode resolves each account's Agency token via Client → organizationSettings.
async function selectDueAccounts(metaMode: 'fake' | 'live', where: SQL | undefined) {
	if (metaMode === 'fake') {
		return db
			.select({ adAccount, metaAccessToken: sql<string | null>`null` })
			.from(adAccount)
			.where(where)
	}
	return db
		.select({ adAccount, metaAccessToken: organizationSettings.metaAccessToken })
		.from(adAccount)
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.leftJoin(organizationSettings, eq(organizationSettings.organizationId, client.agencyId))
		.where(where)
}

async function runAccountTier(
	metaMode: 'fake' | 'live',
	buildMetaClient: (accessToken?: string) => MetaClient,
	now: Date,
): Promise<TierCounts> {
	const result = await withAdvisoryLock(accountTierAdvisoryLock, async () => {
		const dueAccounts = await selectDueAccounts(
			metaMode,
			and(
				inArray(adAccount.connectionStatus, ['pending', 'connected']),
				or(
					isNull(adAccount.accountTierRefreshedAt),
					lte(adAccount.accountTierRefreshedAt, new Date(now.getTime() - accountTierIntervalMilliseconds)),
				),
			),
		)
		const outcomes = await mapWithConcurrency(
			dueAccounts,
			accountTierConcurrency,
			async ({ adAccount: account, metaAccessToken }) => {
				if (metaMode === 'live' && !metaAccessToken) {
					await recordAccountTierSkippedNoToken(account.id, now)
					return 'skippedNoToken' as const
				}
				try {
					await syncAccountTierAccount(buildMetaClient(metaAccessToken ?? undefined), account, now)
					return 'processed' as const
				} catch (error) {
					await recordAccountTierFailure(account.id, error, now)
					return 'failed' as const
				}
			},
		)
		return countOutcomes(outcomes)
	})
	return result ?? { processed: 0, failed: 0, skipped: 1, skippedNoToken: 0 }
}

async function recordAccountTierSkippedNoToken(accountId: string, now: Date) {
	await db
		.update(adAccount)
		.set({ lastPollAttemptAt: now, lastPollError: noTokenMessage, updatedAt: now })
		.where(eq(adAccount.id, accountId))
}

async function syncAccountTierAccount(metaClient: MetaClient, account: typeof adAccount.$inferSelect, now: Date) {
	const baseline = await metaClient.getAccount(account.id)
	const [campaigns, adSets, ads] = await Promise.all([
		metaClient.listCampaigns(account.id),
		metaClient.listAdSets(account.id),
		metaClient.listAds(account.id),
	])
	await db.transaction(async transaction => {
		await transaction
			.update(adAccount)
			.set({
				name: baseline.name,
				currency: baseline.currency,
				timezoneName: baseline.timezoneName,
				connectionStatus: 'connected',
				metaAccountStatus: baseline.metaAccountStatus,
				metaDisableReason: baseline.metaDisableReason,
				balance: baseline.balance,
				isPrepayAccount: baseline.isPrepayAccount,
				fundingSourceType: baseline.fundingSourceType,
				accountTierRefreshedAt: now,
				lastPollAttemptAt: now,
				lastPollError: null,
				updatedAt: now,
			})
			.where(eq(adAccount.id, account.id))

		for (const item of campaigns.items) {
			await transaction
				.insert(campaign)
				.values({
					id: item.id,
					adAccountId: account.id,
					name: item.name,
					effectiveStatus: item.effectiveStatus,
					objective: item.objective,
					deletedAt: null,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: campaign.id,
					set: {
						adAccountId: account.id,
						name: item.name,
						effectiveStatus: item.effectiveStatus,
						objective: item.objective,
						deletedAt: null,
						updatedAt: now,
					},
				})
		}
		for (const item of adSets.items) {
			await transaction
				.insert(adSet)
				.values({
					id: item.id,
					campaignId: item.campaignId,
					name: item.name,
					effectiveStatus: item.effectiveStatus,
					optimizationGoal: item.optimizationGoal,
					resultActionType: item.resultActionType,
					deletedAt: null,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: adSet.id,
					set: {
						campaignId: item.campaignId,
						name: item.name,
						effectiveStatus: item.effectiveStatus,
						optimizationGoal: item.optimizationGoal,
						resultActionType: item.resultActionType,
						deletedAt: null,
						updatedAt: now,
					},
				})
		}
		for (const item of ads.items) {
			await transaction
				.insert(ad)
				.values({
					id: item.id,
					adSetId: item.adSetId,
					name: item.name,
					effectiveStatus: item.effectiveStatus,
					deletedAt: null,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: ad.id,
					set: {
						adSetId: item.adSetId,
						name: item.name,
						effectiveStatus: item.effectiveStatus,
						deletedAt: null,
						updatedAt: now,
					},
				})
		}

		await softDeleteMissingHierarchy(
			transaction,
			account.id,
			campaigns.items.map(item => item.id),
			adSets.items.map(item => item.id),
			ads.items.map(item => item.id),
			now,
		)
	})
}

async function softDeleteMissingHierarchy(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	accountId: string,
	presentCampaignIds: string[],
	presentAdSetIds: string[],
	presentAdIds: string[],
	now: Date,
) {
	const existingCampaigns = await transaction
		.select({ id: campaign.id })
		.from(campaign)
		.where(eq(campaign.adAccountId, accountId))
	const existingAdSets = await transaction
		.select({ id: adSet.id })
		.from(adSet)
		.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
		.where(eq(campaign.adAccountId, accountId))
	const existingAds = await transaction
		.select({ id: ad.id })
		.from(ad)
		.innerJoin(adSet, eq(ad.adSetId, adSet.id))
		.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
		.where(eq(campaign.adAccountId, accountId))
	await markMissing(
		transaction,
		campaign,
		campaign.id,
		existingCampaigns.map(row => row.id),
		presentCampaignIds,
		now,
	)
	await markMissing(
		transaction,
		adSet,
		adSet.id,
		existingAdSets.map(row => row.id),
		presentAdSetIds,
		now,
	)
	await markMissing(
		transaction,
		ad,
		ad.id,
		existingAds.map(row => row.id),
		presentAdIds,
		now,
	)
}

async function markMissing(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	table: typeof campaign | typeof adSet | typeof ad,
	idColumn: typeof campaign.id | typeof adSet.id | typeof ad.id,
	existingIds: string[],
	presentIds: string[],
	now: Date,
) {
	const missingIds = existingIds.filter(id => !presentIds.includes(id))
	if (missingIds.length === 0) return
	await transaction
		.update(table)
		.set({ deletedAt: now, updatedAt: now })
		.where(and(inArray(idColumn, missingIds), isNull(table.deletedAt)))
}

async function recordAccountTierFailure(accountId: string, error: unknown, now: Date) {
	const accessLost = error instanceof MetaApiError && error.code === 10
	await db
		.update(adAccount)
		.set({
			...(accessLost ? { connectionStatus: 'access_lost' as const } : {}),
			lastPollAttemptAt: now,
			lastPollError: describePollError(error),
			updatedAt: now,
		})
		.where(eq(adAccount.id, accountId))
	logger.warn('Fleet Board Account Tier sync failed', { accountId, category: errorCategory(error), accessLost })
}

async function runInsightsTier(
	metaMode: 'fake' | 'live',
	buildMetaClient: (accessToken?: string) => MetaClient,
	now: Date,
): Promise<TierCounts> {
	const result = await withAdvisoryLock(insightsTierAdvisoryLock, async () => {
		const dueAccounts = await selectDueAccounts(
			metaMode,
			and(
				eq(adAccount.connectionStatus, 'connected'),
				or(
					isNull(adAccount.insightsTierRefreshedAt),
					lte(adAccount.insightsTierRefreshedAt, new Date(now.getTime() - insightsTierIntervalMilliseconds)),
				),
			),
		)
		let stoppedByThrottle = false
		const outcomes = await mapWithConcurrency(
			dueAccounts,
			insightsTierConcurrency,
			async ({ adAccount: account, metaAccessToken }) => {
				if (stoppedByThrottle) return 'skipped' as const
				if (metaMode === 'live' && !metaAccessToken) {
					await recordInsightsTierSkippedNoToken(account.id, now)
					return 'skippedNoToken' as const
				}
				try {
					const exhausted = await syncInsightsTierAccount(
						buildMetaClient(metaAccessToken ?? undefined),
						account,
						now,
					)
					if (exhausted) stoppedByThrottle = true
					return 'processed' as const
				} catch (error) {
					await recordInsightsTierFailure(account.id, error, now)
					return 'failed' as const
				}
			},
		)
		return countOutcomes(outcomes)
	})
	return result ?? { processed: 0, failed: 0, skipped: 1, skippedNoToken: 0 }
}

async function recordInsightsTierSkippedNoToken(accountId: string, now: Date) {
	await db
		.update(adAccount)
		.set({ insightsTierAttemptAt: now, insightsTierError: noTokenMessage, updatedAt: now })
		.where(eq(adAccount.id, accountId))
}

async function syncInsightsTierAccount(metaClient: MetaClient, account: typeof adAccount.$inferSelect, now: Date) {
	const timezoneName = account.timezoneName ?? 'UTC'
	const start = account.insightsTierRefreshedAt
		? reconciliationWindow(timezoneName, now).start
		: firstConnectStart(timezoneName, now)
	const end = reconciliationWindow(timezoneName, now).end
	const insights = await metaClient.listDailyInsights(account.id, { start, end })
	const liveAds = await db
		.select({ id: ad.id })
		.from(ad)
		.innerJoin(adSet, eq(ad.adSetId, adSet.id))
		.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
		.where(and(eq(campaign.adAccountId, account.id), eq(ad.effectiveStatus, 'ACTIVE'), isNull(ad.deletedAt)))
	const creatives = await Promise.all(liveAds.map(async row => metaClient.getCreative(row.id)))
	await db.transaction(async transaction => {
		for (const insight of insights.items) await upsertInsight(transaction, insight, now)
		const stored = await transaction
			.select({ adId: adInsight.adId, date: adInsight.date })
			.from(adInsight)
			.innerJoin(ad, eq(adInsight.adId, ad.id))
			.innerJoin(adSet, eq(ad.adSetId, adSet.id))
			.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
			.where(and(eq(campaign.adAccountId, account.id), gte(adInsight.date, start), lte(adInsight.date, end)))
		const received = new Set(insights.items.map(item => `${item.adId}\u0000${item.date}`))
		for (const row of stored) {
			if (!received.has(`${row.adId}\u0000${row.date}`)) {
				await transaction.delete(adInsight).where(and(eq(adInsight.adId, row.adId), eq(adInsight.date, row.date)))
			}
		}
		for (const creative of creatives) {
			if (!creative) continue
			await transaction
				.insert(adCreative)
				.values({
					id: creative.id,
					adId: creative.adId,
					name: creative.name,
					payload: creative.payload,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: adCreative.id,
					set: { adId: creative.adId, name: creative.name, payload: creative.payload, updatedAt: now },
				})
		}
		await transaction
			.update(adAccount)
			.set({ insightsTierRefreshedAt: now, insightsTierAttemptAt: now, insightsTierError: null, updatedAt: now })
			.where(eq(adAccount.id, account.id))
	})
	return insights.throttle.exhausted
}

async function upsertInsight(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	insight: MetaDailyInsight,
	now: Date,
) {
	await transaction
		.insert(adInsight)
		.values({
			adId: insight.adId,
			date: insight.date,
			spend: insight.spend,
			impressions: insight.impressions,
			inlineLinkClicks: insight.inlineLinkClicks,
			clicks: 0,
			actions: insight.actions,
			actionValues: insight.actionValues,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [adInsight.adId, adInsight.date],
			set: {
				spend: insight.spend,
				impressions: insight.impressions,
				inlineLinkClicks: insight.inlineLinkClicks,
				actions: insight.actions,
				actionValues: insight.actionValues,
				updatedAt: now,
			},
		})
}

async function recordInsightsTierFailure(accountId: string, error: unknown, now: Date) {
	await db
		.update(adAccount)
		.set({ insightsTierAttemptAt: now, insightsTierError: describePollError(error), updatedAt: now })
		.where(eq(adAccount.id, accountId))
	logger.warn('Fleet Board Insights Tier sync failed', { accountId, category: errorCategory(error) })
}

async function withAdvisoryLock<T>(lockId: number, work: () => Promise<T>): Promise<T | null> {
	const { SQL } = await import('bun')
	const lockConnection = new SQL({ url: process.env.DATABASE_URL })
	let locked = false
	try {
		const rows = await lockConnection<{ locked: boolean }[]>`select pg_try_advisory_lock(${lockId}) as locked`
		locked = rows[0]?.locked === true
		if (!locked) return null
		return await work()
	} finally {
		if (locked) await lockConnection`select pg_advisory_unlock(${lockId})`
		await lockConnection.end()
	}
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, task: (item: T) => Promise<R>) {
	const results: R[] = []
	let nextIndex = 0
	async function worker() {
		while (nextIndex < items.length) {
			const item = items[nextIndex]
			nextIndex += 1
			results.push(await task(item))
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
	return results
}

function countOutcomes(outcomes: readonly ('processed' | 'failed' | 'skipped' | 'skippedNoToken')[]): TierCounts {
	return outcomes.reduce((counts, outcome) => ({ ...counts, [outcome]: counts[outcome] + 1 }), {
		processed: 0,
		failed: 0,
		skipped: 0,
		skippedNoToken: 0,
	})
}

function describePollError(error: unknown) {
	if (error instanceof MetaApiError) {
		return [
			error.message,
			error.code ? `code=${error.code}` : undefined,
			error.fbtraceId ? `fbtrace=${error.fbtraceId}` : undefined,
		]
			.filter(Boolean)
			.join(' ')
	}
	return error instanceof Error ? error.message : 'Unknown Meta poll failure'
}

function errorCategory(error: unknown) {
	if (error instanceof MetaApiError) {
		if (error.code === 10) return 'authorization'
		if (error.code === 4 || error.status === 429) return 'rate_limit'
		if (error.status >= 500) return 'upstream'
		return 'meta_validation'
	}
	return 'unexpected'
}
