import { randomUUID } from 'node:crypto'

import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'

import { logger } from '../core/logger'
import { db } from '../db'
import {
	ad,
	adAccount,
	adInsight,
	adSet,
	campaign,
	client,
	syncAccountOutcome,
	syncInvocation,
	syncRun,
} from '../db/schema'
import { dateRangeForAccount, firstConnectStart } from '../fleet-board/domain'
import { isMetaAccessLoss, metaThrottleNextDueAt, MetaApiError } from '../meta/client'
import type { MetaClient, MetaDailyInsight, MetaThrottleObservation } from '../meta/client'
import { pruneSyncHistory } from './account-data'
import { metaCapacityConcurrency, priorityForSyncWork, runWithMetaCapacity } from './capacity'
import {
	claimOutcome,
	claimRun,
	describePollError,
	errorCategory,
	finishRun,
	loadAccountForRun,
	mapWithConcurrency,
	outcomeDiagnosticReference,
	readGenerationResult,
} from './durable-run'

const insightsIntervalMilliseconds = 5 * 60 * 1000
const runMaximumActiveMilliseconds = 5 * 60 * 1000
const noTokenMessage = 'No Meta token configured for this Agency'

export type InsightsRunOptions = {
	agencyId: string
	trigger: 'cron' | 'connect' | 'manual'
	force?: boolean
	forceRefreshId?: string
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now?: Date
	clock?: () => Date
}

export type EnqueuedInsightsRun = {
	runId: string
	invocationId: string
	joined: boolean
}

export type InsightsGenerationResult = {
	runId: string
	status: 'queued' | 'running' | 'completed' | 'failed'
	processed: number
	failed: number
	skipped: number
	queued: number
}

type InsightsOutcomeContext = {
	agencyId: string
	runId: string
	outcomeId: string
	leaseOwner: string
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now: Date
	clock: () => Date
}

export async function enqueueInsightsRun({
	agencyId,
	trigger,
	force = false,
	forceRefreshId,
	now = new Date(),
}: Pick<
	InsightsRunOptions,
	'agencyId' | 'trigger' | 'force' | 'forceRefreshId' | 'now'
>): Promise<EnqueuedInsightsRun> {
	await pruneSyncHistory(now)

	return db.transaction(async transaction => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`)
		await transaction
			.update(syncRun)
			.set({ status: 'failed', leaseOwner: null, leaseExpiresAt: null, completedAt: now, updatedAt: now })
			.where(
				and(
					eq(syncRun.agencyId, agencyId),
					eq(syncRun.slice, 'insights'),
					inArray(syncRun.status, ['queued', 'running']),
					lte(syncRun.createdAt, new Date(now.getTime() - runMaximumActiveMilliseconds)),
				),
			)

		const [activeRun] = await transaction
			.select({ id: syncRun.id })
			.from(syncRun)
			.where(
				and(
					eq(syncRun.agencyId, agencyId),
					eq(syncRun.slice, 'insights'),
					inArray(syncRun.status, ['queued', 'running']),
				),
			)
			.orderBy(asc(syncRun.createdAt))
			.limit(1)

		const [joinedRun] = activeRun
			? await transaction
					.update(syncRun)
					.set({ ...(forceRefreshId ? { forceRefreshId } : {}), updatedAt: now })
					.where(and(eq(syncRun.id, activeRun.id), inArray(syncRun.status, ['queued', 'running'])))
					.returning({ id: syncRun.id })
			: []
		const runId = joinedRun?.id ?? randomUUID()
		const joined = Boolean(joinedRun)
		if (!joinedRun) {
			await transaction.insert(syncRun).values({
				id: runId,
				agencyId,
				slice: 'insights',
				trigger,
				status: 'queued',
				diagnosticReference: runDiagnosticReference(runId),
				forceRefreshId,
				createdAt: now,
				updatedAt: now,
			})
		}

		const dueAccounts = await transaction
			.select({ id: adAccount.id })
			.from(adAccount)
			.innerJoin(client, eq(adAccount.clientId, client.id))
			.where(
				and(
					eq(client.agencyId, agencyId),
					inArray(adAccount.connectionStatus, ['pending', 'connected']),
					or(
						eq(adAccount.connectionStatus, 'connected'),
						and(isNotNull(adAccount.accountDataSuccessfulAt), isNotNull(adAccount.hierarchySuccessfulAt)),
					),
					...(force
						? []
						: [
								or(
									lte(adAccount.insightsNextDueAt, now),
									and(isNull(adAccount.insightsSuccessfulAt), isNull(adAccount.insightsAttemptedAt)),
								),
							]),
				),
			)
			.orderBy(asc(adAccount.connectionStatus), asc(adAccount.id))

		if (dueAccounts.length > 0) {
			await transaction
				.insert(syncAccountOutcome)
				.values(
					dueAccounts.map(account => ({
						id: randomUUID(),
						runId,
						adAccountId: account.id,
						slice: 'insights' as const,
						status: 'queued' as const,
						diagnosticReference: insightsDiagnosticReference(runId, account.id),
						createdAt: now,
						updatedAt: now,
					})),
				)
				.onConflictDoNothing()
		}

		const invocationId = randomUUID()
		await transaction.insert(syncInvocation).values({
			id: invocationId,
			agencyId,
			runId,
			trigger,
			receivedAt: now,
			createdAt: now,
		})
		return { runId, invocationId, joined }
	})
}

export async function scheduleInsightsRun(options: InsightsRunOptions) {
	const enqueued = await enqueueInsightsRun(options)
	const result = await runInsightsGeneration({ ...options, runId: enqueued.runId })
	return { ...enqueued, ...result }
}

export async function scheduleInsightsRunsForAgencies(
	options: Omit<InsightsRunOptions, 'agencyId'>,
): Promise<InsightsGenerationResult[]> {
	const agencies = await db
		.select({ id: client.agencyId })
		.from(adAccount)
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.groupBy(client.agencyId)
	return Promise.all(agencies.map(agency => scheduleInsightsRun({ ...options, agencyId: agency.id })))
}

export async function runInsightsGeneration({
	agencyId,
	runId,
	trigger,
	metaMode,
	buildMetaClient,
	now = new Date(),
	clock = () => new Date(),
}: InsightsRunOptions & { runId: string }): Promise<InsightsGenerationResult> {
	const leaseOwner = randomUUID()
	const claimed = await claimRun({ agencyId, runId, slice: 'insights', leaseOwner, now })
	if (!claimed) return await readGenerationResult(runId, 'insights')

	let stopped = false
	while (!stopped) {
		const outcomes = await db
			.select({ id: syncAccountOutcome.id, connectionStatus: adAccount.connectionStatus })
			.from(syncAccountOutcome)
			.innerJoin(adAccount, eq(syncAccountOutcome.adAccountId, adAccount.id))
			.where(
				and(
					eq(syncAccountOutcome.runId, runId),
					eq(syncAccountOutcome.slice, 'insights'),
					eq(syncAccountOutcome.status, 'queued'),
				),
			)
			// Least-recently-attempted first so a resumed generation rotates past the account that
			// exhausted Meta's budget last time instead of stalling on it and starving the rest.
			.orderBy(
				asc(adAccount.connectionStatus),
				sql`${syncAccountOutcome.attemptedAt} asc nulls first`,
				asc(adAccount.id),
			)
		if (outcomes.length === 0) break
		stopped = await mapWithConcurrency(outcomes, metaCapacityConcurrency, async outcome => {
			return runWithMetaCapacity(priorityForSyncWork(trigger, 'insights', outcome.connectionStatus), () =>
				processOutcome({
					agencyId,
					runId,
					outcomeId: outcome.id,
					leaseOwner,
					metaMode,
					buildMetaClient,
					now,
					clock,
				}),
			)
		})
	}

	await finishRun({ runId, slice: 'insights', leaseOwner, now: clock() })
	import('./runtime').then(({ triggerPendingForceRefreshes }) => triggerPendingForceRefreshes()).catch(() => undefined)
	const result = await readGenerationResult(runId, 'insights')
	logger.info('Durable Insights generation completed', {
		agencyId,
		runId,
		status: result.status,
		processed: result.processed,
		failed: result.failed,
		skipped: result.skipped,
	})
	return result
}

async function processOutcome(params: InsightsOutcomeContext) {
	const claimed = await claimOutcome({
		runId: params.runId,
		outcomeId: params.outcomeId,
		slice: 'insights',
		leaseOwner: params.leaseOwner,
		now: params.now,
	})
	if (!claimed) return false

	await db
		.update(adAccount)
		.set({
			insightsAttemptedAt: params.now,
			insightsLeaseOwner: params.leaseOwner,
			insightsLeaseExpiresAt: claimed.leaseExpiresAt,
			updatedAt: params.now,
		})
		.where(eq(adAccount.id, claimed.adAccountId))

	const account = await loadAccountForRun(params.agencyId, claimed.adAccountId, params.metaMode)
	if (!account) {
		await recordOutcomeFailure(
			params,
			new Error('Ad Account disappeared before Insights work started'),
			claimed.adAccountId,
		)
		return false
	}

	try {
		if (params.metaMode === 'live' && !account.metaAccessToken) {
			await recordOutcomeSkipped(params, account.adAccount.id)
			return false
		}

		const timezoneName = account.adAccount.timezoneName ?? 'UTC'
		const today = dateRangeForAccount('today', timezoneName, params.now)
		const range =
			account.adAccount.connectionStatus === 'pending'
				? { start: firstConnectStart(timezoneName, params.now), end: today.end }
				: today
		const metaClient = params.buildMetaClient(account.metaAccessToken ?? undefined)
		const insights = await metaClient.listDailyInsights(account.adAccount.id, range)
		if (insights.throttle.accountExhausted && !insights.throttle.appExhausted) {
			await recordOutcomeThrottled(params, account.adAccount.id, insights.throttle)
			return false
		}
		const knownAds = await db
			.select({ id: ad.id })
			.from(ad)
			.innerJoin(adSet, eq(ad.adSetId, adSet.id))
			.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
			.where(and(eq(campaign.adAccountId, account.adAccount.id), isNull(ad.deletedAt)))
		const knownAdIds = new Set(knownAds.map(row => row.id))
		const received = new Set(
			insights.items.filter(item => knownAdIds.has(item.adId)).map(item => `${item.adId}\u0000${item.date}`),
		)
		const committedAt = params.clock()

		await db.transaction(async transaction => {
			const outcome = await transaction
				.update(syncAccountOutcome)
				.set({
					status: 'succeeded',
					leaseOwner: null,
					leaseExpiresAt: null,
					completedAt: committedAt,
					successfulCommitAt: committedAt,
					diagnosticReference: insightsDiagnosticReference(params.runId, account.adAccount.id),
					error: null,
					updatedAt: committedAt,
				})
				.where(
					and(
						eq(syncAccountOutcome.id, params.outcomeId),
						eq(syncAccountOutcome.leaseOwner, params.leaseOwner),
						eq(syncAccountOutcome.status, 'running'),
					),
				)
				.returning({ id: syncAccountOutcome.id })
			if (!outcome[0]) return

			for (const insight of insights.items) {
				if (!knownAdIds.has(insight.adId)) continue
				await upsertInsight(transaction, insight, committedAt)
			}
			if (insights.complete) {
				const stored = await transaction
					.select({ adId: adInsight.adId, date: adInsight.date })
					.from(adInsight)
					.innerJoin(ad, eq(adInsight.adId, ad.id))
					.innerJoin(adSet, eq(ad.adSetId, adSet.id))
					.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
					.where(
						and(
							eq(campaign.adAccountId, account.adAccount.id),
							gte(adInsight.date, range.start),
							lte(adInsight.date, range.end),
						),
					)
				for (const row of stored) {
					if (!received.has(`${row.adId}\u0000${row.date}`)) {
						await transaction
							.delete(adInsight)
							.where(and(eq(adInsight.adId, row.adId), eq(adInsight.date, row.date)))
					}
				}
			}

			await transaction
				.update(adAccount)
				.set({
					...(insights.complete &&
					account.adAccount.connectionStatus === 'pending' &&
					account.adAccount.accountDataSuccessfulAt &&
					account.adAccount.hierarchySuccessfulAt
						? { connectionStatus: 'connected' as const }
						: {}),
					...(insights.complete && account.adAccount.connectionStatus === 'pending'
						? { initialImportHistoryCompletedAt: committedAt }
						: {}),
					insightsAttemptedAt: committedAt,
					insightsSuccessfulAt: committedAt,
					insightsError: null,
					insightsDiagnosticReference: insightsDiagnosticReference(params.runId, account.adAccount.id),
					insightsMetaErrorCode: null,
					insightsNextDueAt: metaThrottleNextDueAt(insights.throttle, committedAt, insightsIntervalMilliseconds),
					insightsLeaseOwner: null,
					insightsLeaseExpiresAt: null,
					updatedAt: committedAt,
				})
				.where(eq(adAccount.id, account.adAccount.id))
		})
		return insights.throttle.appExhausted
	} catch (error) {
		await recordOutcomeFailure(params, error, account.adAccount.id)
		return error instanceof MetaApiError && error.throttle?.appExhausted === true
	}
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

async function recordOutcomeSkipped(params: InsightsOutcomeContext, accountId: string) {
	const occurredAt = params.clock()
	const diagnosticReference = insightsDiagnosticReference(params.runId, accountId)
	await db.transaction(async transaction => {
		const outcome = await transaction
			.update(syncAccountOutcome)
			.set({
				status: 'skipped',
				leaseOwner: null,
				leaseExpiresAt: null,
				completedAt: occurredAt,
				diagnosticReference,
				error: noTokenMessage,
				updatedAt: occurredAt,
			})
			.where(
				and(
					eq(syncAccountOutcome.id, params.outcomeId),
					eq(syncAccountOutcome.leaseOwner, params.leaseOwner),
					eq(syncAccountOutcome.status, 'running'),
				),
			)
			.returning({ id: syncAccountOutcome.id })
		if (!outcome[0]) return
		await transaction
			.update(adAccount)
			.set({
				insightsAttemptedAt: occurredAt,
				insightsError: noTokenMessage,
				insightsDiagnosticReference: diagnosticReference,
				insightsMetaErrorCode: null,
				insightsNextDueAt: new Date(occurredAt.getTime() + insightsIntervalMilliseconds),
				insightsLeaseOwner: null,
				insightsLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
}

async function recordOutcomeThrottled(
	params: InsightsOutcomeContext,
	accountId: string,
	throttle: MetaThrottleObservation,
) {
	const occurredAt = params.clock()
	const diagnosticReference = insightsDiagnosticReference(params.runId, accountId)
	await db.transaction(async transaction => {
		const outcome = await transaction
			.update(syncAccountOutcome)
			.set({
				status: 'skipped',
				leaseOwner: null,
				leaseExpiresAt: null,
				completedAt: occurredAt,
				diagnosticReference,
				error: 'Meta throttle budget exhausted',
				updatedAt: occurredAt,
			})
			.where(
				and(
					eq(syncAccountOutcome.id, params.outcomeId),
					eq(syncAccountOutcome.leaseOwner, params.leaseOwner),
					eq(syncAccountOutcome.status, 'running'),
				),
			)
			.returning({ id: syncAccountOutcome.id })
		if (!outcome[0]) return
		await transaction
			.update(adAccount)
			.set({
				insightsAttemptedAt: occurredAt,
				insightsError: 'Meta throttle budget exhausted',
				insightsDiagnosticReference: diagnosticReference,
				insightsMetaErrorCode: null,
				insightsNextDueAt: metaThrottleNextDueAt(throttle, occurredAt, insightsIntervalMilliseconds),
				insightsLeaseOwner: null,
				insightsLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
}

async function recordOutcomeFailure(params: InsightsOutcomeContext, error: unknown, accountId: string) {
	const message = describePollError(error)
	const diagnosticReference = insightsDiagnosticReference(params.runId, accountId)
	const occurredAt = params.clock()
	const accessLost = isMetaAccessLoss(error)
	await db.transaction(async transaction => {
		const outcome = await transaction
			.update(syncAccountOutcome)
			.set({
				status: 'failed',
				leaseOwner: null,
				leaseExpiresAt: null,
				completedAt: occurredAt,
				diagnosticReference,
				error: message,
				updatedAt: occurredAt,
			})
			.where(
				and(
					eq(syncAccountOutcome.id, params.outcomeId),
					eq(syncAccountOutcome.leaseOwner, params.leaseOwner),
					eq(syncAccountOutcome.status, 'running'),
				),
			)
			.returning({ id: syncAccountOutcome.id })
		if (!outcome[0]) return
		await transaction
			.update(adAccount)
			.set({
				...(accessLost ? { connectionStatus: 'access_lost' as const } : {}),
				insightsAttemptedAt: occurredAt,
				insightsError: message,
				insightsDiagnosticReference: diagnosticReference,
				insightsMetaErrorCode: error instanceof MetaApiError ? (error.code ?? null) : null,
				insightsNextDueAt: metaThrottleNextDueAt(
					error instanceof MetaApiError ? error.throttle : undefined,
					occurredAt,
					insightsIntervalMilliseconds,
				),
				insightsLeaseOwner: null,
				insightsLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
	logger.warn('Durable Insights sync failed', {
		agencyId: params.agencyId,
		runId: params.runId,
		outcomeId: params.outcomeId,
		category: errorCategory(error),
	})
}

function runDiagnosticReference(runId: string) {
	return `sync-run/${runId}`
}

function insightsDiagnosticReference(runId: string, accountId: string) {
	return outcomeDiagnosticReference(runId, 'insights', accountId)
}
