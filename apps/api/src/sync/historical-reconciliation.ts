import { randomUUID } from 'node:crypto'

import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'

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
import { dateRangeForAccount, historicalReconciliationRangeForEndDate } from '../fleet-board/domain'
import { isMetaAccessLoss, MetaApiError } from '../meta/client'
import type { MetaClient, MetaDailyInsight } from '../meta/client'
import { pruneSyncHistory } from './account-data'
import { priorityForSyncWork, runWithMetaCapacity } from './capacity'
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

const runMaximumActiveMilliseconds = 5 * 60 * 1000
const reconciliationConcurrency = 1
const reconciliationWindowStartMinutes = 2 * 60
const reconciliationWindowEndMinutes = 5 * 60
const reconciliationSlotLengthMinutes = 5
const reconciliationSlotCount =
	(reconciliationWindowEndMinutes - reconciliationWindowStartMinutes) / reconciliationSlotLengthMinutes
const noTokenMessage = 'No Meta token configured for this Agency'

export type HistoricalReconciliationRunOptions = {
	agencyId: string
	trigger: 'cron' | 'connect' | 'manual'
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now?: Date
	clock?: () => Date
}

export type EnqueuedHistoricalReconciliationRun = {
	runId: string
	invocationId: string
	joined: boolean
}

export type HistoricalReconciliationGenerationResult = {
	runId: string
	status: 'queued' | 'running' | 'completed' | 'failed'
	processed: number
	failed: number
	skipped: number
	queued: number
}

type ReconciliationAccount = {
	id: string
	timezoneName: string | null
	createdAt: Date
	historicalReconciliationAttemptedAt: Date | null
	historicalReconciliationSuccessfulAt: Date | null
	historicalReconciliationDate: string | null
	historicalReconciliationPendingDate: string | null
}

type HistoricalReconciliationOutcomeContext = {
	agencyId: string
	runId: string
	outcomeId: string
	leaseOwner: string
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now: Date
	clock: () => Date
}

export async function enqueueHistoricalReconciliationRun({
	agencyId,
	trigger,
	now = new Date(),
}: Pick<
	HistoricalReconciliationRunOptions,
	'agencyId' | 'trigger' | 'now'
>): Promise<EnqueuedHistoricalReconciliationRun> {
	await pruneSyncHistory(now)

	return db.transaction(async transaction => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`)
		await transaction
			.update(syncRun)
			.set({ status: 'failed', leaseOwner: null, leaseExpiresAt: null, completedAt: now, updatedAt: now })
			.where(
				and(
					eq(syncRun.agencyId, agencyId),
					eq(syncRun.slice, 'historical_reconciliation'),
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
					eq(syncRun.slice, 'historical_reconciliation'),
					inArray(syncRun.status, ['queued', 'running']),
				),
			)
			.orderBy(asc(syncRun.createdAt))
			.limit(1)

		const [joinedRun] = activeRun
			? await transaction
					.update(syncRun)
					.set({ updatedAt: now })
					.where(and(eq(syncRun.id, activeRun.id), inArray(syncRun.status, ['queued', 'running'])))
					.returning({ id: syncRun.id })
			: []
		const runId = joinedRun?.id ?? randomUUID()
		const joined = Boolean(joinedRun)
		if (!joinedRun) {
			await transaction.insert(syncRun).values({
				id: runId,
				agencyId,
				slice: 'historical_reconciliation',
				trigger,
				status: 'queued',
				diagnosticReference: runDiagnosticReference(runId),
				createdAt: now,
				updatedAt: now,
			})
		}

		const accounts = await transaction
			.select({
				id: adAccount.id,
				timezoneName: adAccount.timezoneName,
				createdAt: adAccount.createdAt,
				historicalReconciliationAttemptedAt: adAccount.historicalReconciliationAttemptedAt,
				historicalReconciliationSuccessfulAt: adAccount.historicalReconciliationSuccessfulAt,
				historicalReconciliationDate: adAccount.historicalReconciliationDate,
				historicalReconciliationPendingDate: adAccount.historicalReconciliationPendingDate,
			})
			.from(adAccount)
			.innerJoin(client, eq(adAccount.clientId, client.id))
			.where(
				and(
					eq(client.agencyId, agencyId),
					eq(adAccount.connectionStatus, 'connected'),
					isNotNull(adAccount.accountDataSuccessfulAt),
					isNotNull(adAccount.hierarchySuccessfulAt),
				),
			)

		const dueAccounts = accounts
			.map(account => ({
				account,
				currentTargetDate: reconciliationTargetDate(account, now),
				targetDate: account.historicalReconciliationPendingDate ?? reconciliationTargetDate(account, now),
			}))
			.filter(({ account, currentTargetDate }) => isReconciliationDue(account, currentTargetDate, now))

		if (dueAccounts.length > 0) {
			for (const { account, targetDate } of dueAccounts) {
				await transaction
					.update(adAccount)
					.set({ historicalReconciliationPendingDate: targetDate, updatedAt: now })
					.where(eq(adAccount.id, account.id))
			}
			await transaction
				.insert(syncAccountOutcome)
				.values(
					dueAccounts.map(({ account, targetDate }) => ({
						id: randomUUID(),
						runId,
						adAccountId: account.id,
						slice: 'historical_reconciliation' as const,
						status: 'queued' as const,
						reconciliationDate: targetDate,
						diagnosticReference: reconciliationDiagnosticReference(runId, account.id),
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

export async function scheduleHistoricalReconciliationRun(options: HistoricalReconciliationRunOptions) {
	const enqueued = await enqueueHistoricalReconciliationRun(options)
	const result = await runHistoricalReconciliationGeneration({ ...options, runId: enqueued.runId })
	return { ...enqueued, ...result }
}

export async function scheduleHistoricalReconciliationRunsForAgencies(
	options: Omit<HistoricalReconciliationRunOptions, 'agencyId'>,
): Promise<HistoricalReconciliationGenerationResult[]> {
	const agencies = await db
		.select({ id: client.agencyId })
		.from(adAccount)
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.groupBy(client.agencyId)
	return Promise.all(agencies.map(agency => scheduleHistoricalReconciliationRun({ ...options, agencyId: agency.id })))
}

export async function runHistoricalReconciliationGeneration({
	agencyId,
	runId,
	trigger,
	metaMode,
	buildMetaClient,
	now = new Date(),
	clock = () => new Date(),
}: HistoricalReconciliationRunOptions & {
	runId: string
}): Promise<HistoricalReconciliationGenerationResult> {
	const leaseOwner = randomUUID()
	const claimed = await claimRun({ agencyId, runId, slice: 'historical_reconciliation', leaseOwner, now })
	if (!claimed) return await readGenerationResult(runId, 'historical_reconciliation')

	let stopped = false
	while (!stopped) {
		const outcomes = await db
			.select({ id: syncAccountOutcome.id })
			.from(syncAccountOutcome)
			.where(
				and(
					eq(syncAccountOutcome.runId, runId),
					eq(syncAccountOutcome.slice, 'historical_reconciliation'),
					eq(syncAccountOutcome.status, 'queued'),
				),
			)
			.orderBy(asc(syncAccountOutcome.createdAt))
		if (outcomes.length === 0) break
		stopped = await mapWithConcurrency(outcomes, reconciliationConcurrency, async outcome =>
			runWithMetaCapacity(priorityForSyncWork(trigger, 'historical_reconciliation'), () =>
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
			),
		)
	}

	await finishRun({ runId, slice: 'historical_reconciliation', leaseOwner, now: clock() })
	const result = await readGenerationResult(runId, 'historical_reconciliation')
	logger.info('Historical reconciliation completed', {
		agencyId,
		runId,
		status: result.status,
		processed: result.processed,
		failed: result.failed,
		skipped: result.skipped,
	})
	return result
}

async function processOutcome(params: HistoricalReconciliationOutcomeContext) {
	const claimed = await claimOutcome({
		runId: params.runId,
		outcomeId: params.outcomeId,
		slice: 'historical_reconciliation',
		leaseOwner: params.leaseOwner,
		now: params.now,
	})
	if (!claimed) return false

	await db
		.update(adAccount)
		.set({
			historicalReconciliationAttemptedAt: params.now,
			historicalReconciliationLeaseOwner: params.leaseOwner,
			historicalReconciliationLeaseExpiresAt: claimed.leaseExpiresAt,
			updatedAt: params.now,
		})
		.where(eq(adAccount.id, claimed.adAccountId))

	const account = await loadAccountForRun(params.agencyId, claimed.adAccountId, params.metaMode)
	if (!account) {
		await recordOutcomeFailure(
			params,
			new Error('Ad Account disappeared before Historical Reconciliation work started'),
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
		const reconciliationDate =
			claimed.reconciliationDate ?? dateRangeForAccount('yesterday', timezoneName, params.now).end
		const range = historicalReconciliationRangeForEndDate(reconciliationDate)
		const insights = await params
			.buildMetaClient(account.metaAccessToken ?? undefined)
			.listDailyInsights(account.adAccount.id, range)
		if (insights.throttle.accountExhausted && !insights.throttle.appExhausted) {
			await recordOutcomeThrottled(params, account.adAccount.id)
			return false
		}
		const knownAds = await db
			.select({ id: ad.id })
			.from(ad)
			.innerJoin(adSet, eq(ad.adSetId, adSet.id))
			.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
			.where(eq(campaign.adAccountId, account.adAccount.id))
		const knownAdIds = new Set(knownAds.map(row => row.id))
		const received = new Set(
			insights.items.filter(item => knownAdIds.has(item.adId)).map(item => `${item.adId}\u0000${item.date}`),
		)
		const committedAt = params.clock()
		const currentTargetDate = dateRangeForAccount('yesterday', timezoneName, committedAt).end
		const nextPendingDate = reconciliationDate < currentTargetDate ? currentTargetDate : null

		await db.transaction(async transaction => {
			const outcome = await transaction
				.update(syncAccountOutcome)
				.set({
					status: 'succeeded',
					leaseOwner: null,
					leaseExpiresAt: null,
					completedAt: committedAt,
					successfulCommitAt: committedAt,
					diagnosticReference: reconciliationDiagnosticReference(params.runId, account.adAccount.id),
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
				if (knownAdIds.has(insight.adId)) await upsertInsight(transaction, insight, committedAt)
			}

			if (insights.complete && knownAdIds.size > 0) {
				const stored = await transaction
					.select({ adId: adInsight.adId, date: adInsight.date })
					.from(adInsight)
					.where(
						and(
							inArray(adInsight.adId, [...knownAdIds]),
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
					historicalReconciliationAttemptedAt: committedAt,
					historicalReconciliationSuccessfulAt: committedAt,
					historicalReconciliationDate: reconciliationDate,
					historicalReconciliationPendingDate: nextPendingDate,
					historicalReconciliationError: null,
					historicalReconciliationDiagnosticReference: reconciliationDiagnosticReference(
						params.runId,
						account.adAccount.id,
					),
					historicalReconciliationMetaErrorCode: null,
					historicalReconciliationLeaseOwner: null,
					historicalReconciliationLeaseExpiresAt: null,
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

async function recordOutcomeSkipped(params: HistoricalReconciliationOutcomeContext, accountId: string) {
	const occurredAt = params.clock()
	const diagnosticReference = reconciliationDiagnosticReference(params.runId, accountId)
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
				historicalReconciliationAttemptedAt: occurredAt,
				historicalReconciliationError: noTokenMessage,
				historicalReconciliationDiagnosticReference: diagnosticReference,
				historicalReconciliationMetaErrorCode: null,
				historicalReconciliationLeaseOwner: null,
				historicalReconciliationLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
}

async function recordOutcomeThrottled(params: HistoricalReconciliationOutcomeContext, accountId: string) {
	const occurredAt = params.clock()
	const diagnosticReference = reconciliationDiagnosticReference(params.runId, accountId)
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
				historicalReconciliationAttemptedAt: occurredAt,
				historicalReconciliationError: 'Meta throttle budget exhausted',
				historicalReconciliationDiagnosticReference: diagnosticReference,
				historicalReconciliationMetaErrorCode: null,
				historicalReconciliationLeaseOwner: null,
				historicalReconciliationLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
}

async function recordOutcomeFailure(params: HistoricalReconciliationOutcomeContext, error: unknown, accountId: string) {
	const message = describePollError(error)
	const diagnosticReference = reconciliationDiagnosticReference(params.runId, accountId)
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
				historicalReconciliationAttemptedAt: occurredAt,
				historicalReconciliationError: message,
				historicalReconciliationDiagnosticReference: diagnosticReference,
				historicalReconciliationMetaErrorCode: error instanceof MetaApiError ? (error.code ?? null) : null,
				historicalReconciliationLeaseOwner: null,
				historicalReconciliationLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
	logger.warn('Historical reconciliation failed', {
		agencyId: params.agencyId,
		runId: params.runId,
		outcomeId: params.outcomeId,
		category: errorCategory(error),
	})
}

function reconciliationTargetDate(account: Pick<ReconciliationAccount, 'timezoneName'>, now: Date) {
	return dateRangeForAccount('yesterday', account.timezoneName ?? 'UTC', now).end
}

function isReconciliationDue(account: ReconciliationAccount, targetDate: string, now: Date) {
	const timezoneName = account.timezoneName ?? 'UTC'
	const localMinutes = localMinutesForAccount(timezoneName, now)
	if (account.historicalReconciliationPendingDate) return account.historicalReconciliationPendingDate < targetDate

	const hasNotCompletedTarget = (account.historicalReconciliationDate ?? '') < targetDate
	if (!hasNotCompletedTarget) return false
	if (isAssignedNightSlot(account.id, localMinutes)) return true
	return (
		localMinutes >= reconciliationWindowEndMinutes &&
		(account.historicalReconciliationAttemptedAt !== null ||
			wasEligibleBeforeAssignedSlot(account, timezoneName, now))
	)
}

function isAssignedNightSlot(accountId: string, localMinutes: number) {
	if (localMinutes < reconciliationWindowStartMinutes || localMinutes >= reconciliationWindowEndMinutes) return false
	const slotStart = assignedSlotStart(accountId)
	return localMinutes >= slotStart && localMinutes < slotStart + reconciliationSlotLengthMinutes
}

function wasEligibleBeforeAssignedSlot(account: ReconciliationAccount, timezoneName: string, now: Date) {
	const localDate = dateRangeForAccount('today', timezoneName, now).end
	const createdDate = dateRangeForAccount('today', timezoneName, account.createdAt).end
	if (createdDate < localDate) return true
	if (createdDate > localDate) return false
	return localMinutesForAccount(timezoneName, account.createdAt) <= assignedSlotStart(account.id)
}

function assignedSlotStart(accountId: string) {
	return (
		reconciliationWindowStartMinutes +
		(hashAccountId(accountId) % reconciliationSlotCount) * reconciliationSlotLengthMinutes
	)
}

function localMinutesForAccount(timezoneName: string, now: Date) {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: timezoneName,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(now)
	const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
	return Number(values.hour) * 60 + Number(values.minute)
}

function hashAccountId(accountId: string) {
	let hash = 0
	for (const character of accountId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
	return hash
}

function runDiagnosticReference(runId: string) {
	return `sync-run/${runId}`
}

function reconciliationDiagnosticReference(runId: string, accountId: string) {
	return outcomeDiagnosticReference(runId, 'historical_reconciliation', accountId)
}
