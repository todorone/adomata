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
	organizationSettings,
	syncAccountOutcome,
	syncInvocation,
	syncRun,
} from '../db/schema'
import { dateRangeForAccount, firstConnectStart } from '../fleet-board/domain'
import { MetaApiError } from '../meta/client'
import type { MetaClient, MetaDailyInsight } from '../meta/client'
import { pruneSyncHistory } from './account-data'

const insightsIntervalMilliseconds = 5 * 60 * 1000
const runLeaseMilliseconds = 60 * 1000
const insightsConcurrency = 1
const noTokenMessage = 'No Meta token configured for this Agency'

export type InsightsRunOptions = {
	agencyId: string
	trigger: 'cron' | 'connect' | 'manual'
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
	now = new Date(),
}: Pick<InsightsRunOptions, 'agencyId' | 'trigger' | 'now'>): Promise<EnqueuedInsightsRun> {
	await pruneSyncHistory(now)

	return db.transaction(async transaction => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`)

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

		const runId = activeRun?.id ?? randomUUID()
		const joined = Boolean(activeRun)
		if (!activeRun) {
			await transaction.insert(syncRun).values({
				id: runId,
				agencyId,
				slice: 'insights',
				trigger,
				status: 'queued',
				diagnosticReference: runDiagnosticReference(runId),
				createdAt: now,
				updatedAt: now,
			})

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
						or(isNull(adAccount.insightsSuccessfulAt), lte(adAccount.insightsNextDueAt, now)),
					),
				)

			if (dueAccounts.length > 0) {
				await transaction.insert(syncAccountOutcome).values(
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
			}
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
	const results: InsightsGenerationResult[] = []
	for (const agency of agencies) results.push(await scheduleInsightsRun({ ...options, agencyId: agency.id }))
	return results
}

export async function runInsightsGeneration({
	agencyId,
	runId,
	metaMode,
	buildMetaClient,
	now = new Date(),
	clock = () => new Date(),
}: InsightsRunOptions & { runId: string }): Promise<InsightsGenerationResult> {
	const leaseOwner = randomUUID()
	const leaseExpiresAt = new Date(now.getTime() + runLeaseMilliseconds)
	const claimed = await claimRun({ agencyId, runId, leaseOwner, now, leaseExpiresAt })
	if (!claimed) return await readGenerationResult(runId)

	const outcomes = await db
		.select({ id: syncAccountOutcome.id })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'insights')))
		.orderBy(asc(syncAccountOutcome.createdAt))
	await mapWithConcurrency(outcomes, insightsConcurrency, async outcome => {
		return processOutcome({
			agencyId,
			runId,
			outcomeId: outcome.id,
			leaseOwner,
			metaMode,
			buildMetaClient,
			now,
			clock,
		})
	})

	await finishRun({ runId, leaseOwner, now: clock() })
	const result = await readGenerationResult(runId)
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

async function claimRun(params: {
	agencyId: string
	runId: string
	leaseOwner: string
	now: Date
	leaseExpiresAt: Date
}) {
	return db.transaction(async transaction => {
		const [run] = await transaction
			.update(syncRun)
			.set({
				status: 'running',
				leaseOwner: params.leaseOwner,
				leaseExpiresAt: params.leaseExpiresAt,
				startedAt: params.now,
				updatedAt: params.now,
			})
			.where(
				and(
					eq(syncRun.id, params.runId),
					eq(syncRun.agencyId, params.agencyId),
					eq(syncRun.slice, 'insights'),
					or(
						eq(syncRun.status, 'queued'),
						and(
							eq(syncRun.status, 'running'),
							or(isNull(syncRun.leaseExpiresAt), lte(syncRun.leaseExpiresAt, params.now)),
						),
					),
				),
			)
			.returning({ id: syncRun.id })
		if (!run) return false

		await transaction
			.update(syncAccountOutcome)
			.set({ status: 'queued', leaseOwner: null, leaseExpiresAt: null, updatedAt: params.now })
			.where(
				and(
					eq(syncAccountOutcome.runId, params.runId),
					eq(syncAccountOutcome.slice, 'insights'),
					eq(syncAccountOutcome.status, 'running'),
					or(isNull(syncAccountOutcome.leaseExpiresAt), lte(syncAccountOutcome.leaseExpiresAt, params.now)),
				),
			)
		return true
	})
}

async function loadAccountForRun(agencyId: string, accountId: string, metaMode: 'fake' | 'live') {
	if (metaMode === 'fake') {
		const [account] = await db
			.select({ adAccount, metaAccessToken: sql<string | null>`null` })
			.from(adAccount)
			.innerJoin(client, eq(adAccount.clientId, client.id))
			.where(and(eq(adAccount.id, accountId), eq(client.agencyId, agencyId)))
			.limit(1)
		return account
	}

	const [account] = await db
		.select({ adAccount, metaAccessToken: organizationSettings.metaAccessToken })
		.from(adAccount)
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.leftJoin(organizationSettings, eq(organizationSettings.organizationId, client.agencyId))
		.where(and(eq(adAccount.id, accountId), eq(client.agencyId, agencyId)))
		.limit(1)
	return account
}

async function processOutcome(params: InsightsOutcomeContext) {
	const leaseExpiresAt = new Date(params.now.getTime() + runLeaseMilliseconds)
	const claimed = await db
		.update(syncAccountOutcome)
		.set({
			status: 'running',
			leaseOwner: params.leaseOwner,
			leaseExpiresAt,
			attemptedAt: params.now,
			updatedAt: params.now,
		})
		.where(
			and(
				eq(syncAccountOutcome.id, params.outcomeId),
				eq(syncAccountOutcome.runId, params.runId),
				eq(syncAccountOutcome.slice, 'insights'),
				eq(syncAccountOutcome.status, 'queued'),
			),
		)
		.returning({ adAccountId: syncAccountOutcome.adAccountId })
	if (!claimed[0]) return false

	await db
		.update(adAccount)
		.set({
			insightsAttemptedAt: params.now,
			insightsLeaseOwner: params.leaseOwner,
			insightsLeaseExpiresAt: leaseExpiresAt,
			updatedAt: params.now,
		})
		.where(eq(adAccount.id, claimed[0].adAccountId))

	const account = await loadAccountForRun(params.agencyId, claimed[0].adAccountId, params.metaMode)
	if (!account) {
		await recordOutcomeFailure(
			params,
			new Error('Ad Account disappeared before Insights work started'),
			claimed[0].adAccountId,
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

			await transaction
				.update(adAccount)
				.set({
					...(account.adAccount.connectionStatus === 'pending' &&
					account.adAccount.accountDataSuccessfulAt &&
					account.adAccount.hierarchySuccessfulAt
						? { connectionStatus: 'connected' as const }
						: {}),
					insightsAttemptedAt: committedAt,
					insightsSuccessfulAt: committedAt,
					insightsError: null,
					insightsDiagnosticReference: insightsDiagnosticReference(params.runId, account.adAccount.id),
					insightsNextDueAt: new Date(committedAt.getTime() + insightsIntervalMilliseconds),
					insightsLeaseOwner: null,
					insightsLeaseExpiresAt: null,
					insightsTierAttemptAt: committedAt,
					insightsTierRefreshedAt: committedAt,
					insightsTierError: null,
					updatedAt: committedAt,
				})
				.where(eq(adAccount.id, account.adAccount.id))
		})
		return insights.throttle.exhausted
	} catch (error) {
		await recordOutcomeFailure(params, error, account.adAccount.id)
		return false
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
				insightsNextDueAt: new Date(occurredAt.getTime() + insightsIntervalMilliseconds),
				insightsLeaseOwner: null,
				insightsLeaseExpiresAt: null,
				insightsTierAttemptAt: occurredAt,
				insightsTierError: noTokenMessage,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
}

async function recordOutcomeFailure(params: InsightsOutcomeContext, error: unknown, accountId: string) {
	const message = describePollError(error)
	const diagnosticReference = insightsDiagnosticReference(params.runId, accountId)
	const occurredAt = params.clock()
	const accessLost = isAccessLoss(error)
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
				insightsNextDueAt: new Date(occurredAt.getTime() + insightsIntervalMilliseconds),
				insightsLeaseOwner: null,
				insightsLeaseExpiresAt: null,
				insightsTierAttemptAt: occurredAt,
				insightsTierError: message,
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

async function finishRun({ runId, leaseOwner, now }: { runId: string; leaseOwner: string; now: Date }) {
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'insights')))
	const status = outcomes.some(outcome => outcome.status === 'queued' || outcome.status === 'running')
		? 'running'
		: outcomes.some(outcome => outcome.status === 'failed')
			? 'failed'
			: 'completed'
	await db
		.update(syncRun)
		.set({
			status,
			leaseOwner: status === 'running' ? leaseOwner : null,
			leaseExpiresAt: status === 'running' ? new Date(now.getTime() + runLeaseMilliseconds) : null,
			completedAt: status === 'running' ? null : now,
			updatedAt: now,
		})
		.where(and(eq(syncRun.id, runId), eq(syncRun.slice, 'insights'), eq(syncRun.leaseOwner, leaseOwner)))
}

async function readGenerationResult(runId: string): Promise<InsightsGenerationResult> {
	const [run] = await db.select().from(syncRun).where(eq(syncRun.id, runId)).limit(1)
	if (!run) throw new Error(`Sync run ${runId} not found`)
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'insights')))
	return {
		runId,
		status: run.status,
		processed: outcomes.filter(outcome => outcome.status === 'succeeded').length,
		failed: outcomes.filter(outcome => outcome.status === 'failed').length,
		skipped: outcomes.filter(outcome => outcome.status === 'skipped').length,
		queued: outcomes.filter(outcome => outcome.status === 'queued' || outcome.status === 'running').length,
	}
}

async function mapWithConcurrency<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<boolean>) {
	let nextIndex = 0
	let stopped = false
	async function worker() {
		while (!stopped && nextIndex < items.length) {
			const item = items[nextIndex]
			nextIndex += 1
			if (await task(item)) stopped = true
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

function runDiagnosticReference(runId: string) {
	return `sync-run/${runId}`
}

function insightsDiagnosticReference(runId: string, accountId: string) {
	return `${runDiagnosticReference(runId)}/insights/${accountId}`
}

function isAccessLoss(error: unknown) {
	return error instanceof MetaApiError && (error.code === 10 || error.code === 190)
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
		if (isAccessLoss(error)) return 'authorization'
		if (error.code === 4 || error.status === 429) return 'rate_limit'
		if (error.status >= 500) return 'upstream'
		return 'meta_validation'
	}
	return 'unexpected'
}
