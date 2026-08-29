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
import { dateRangeForAccount, historicalReconciliationRangeForEndDate } from '../fleet-board/domain'
import { isMetaAccessLoss, isMetaRateLimit, MetaApiError } from '../meta/client'
import type { MetaClient, MetaDailyInsight } from '../meta/client'
import { pruneSyncHistory } from './account-data'
import { priorityForSyncWork, runWithMetaCapacity } from './capacity'

const runLeaseMilliseconds = 60 * 1000
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

		const runId = activeRun?.id ?? randomUUID()
		const joined = Boolean(activeRun)
		if (!activeRun) {
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
				await transaction.insert(syncAccountOutcome).values(
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
	const leaseExpiresAt = new Date(now.getTime() + runLeaseMilliseconds)
	const claimed = await claimRun({ agencyId, runId, leaseOwner, now, leaseExpiresAt })
	if (!claimed) return await readGenerationResult(runId)

	const outcomes = await db
		.select({ id: syncAccountOutcome.id })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'historical_reconciliation')))
		.orderBy(asc(syncAccountOutcome.createdAt))
	await mapWithConcurrency(outcomes, reconciliationConcurrency, async outcome =>
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

	await finishRun({ runId, leaseOwner, now: clock() })
	const result = await readGenerationResult(runId)
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
					eq(syncRun.slice, 'historical_reconciliation'),
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
					eq(syncAccountOutcome.slice, 'historical_reconciliation'),
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

async function processOutcome(params: HistoricalReconciliationOutcomeContext) {
	const leaseExpiresAt = new Date(params.now.getTime() + runLeaseMilliseconds)
	const [claimed] = await db
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
				eq(syncAccountOutcome.slice, 'historical_reconciliation'),
				eq(syncAccountOutcome.status, 'queued'),
			),
		)
		.returning({
			adAccountId: syncAccountOutcome.adAccountId,
			reconciliationDate: syncAccountOutcome.reconciliationDate,
		})
	if (!claimed) return false

	await db
		.update(adAccount)
		.set({
			historicalReconciliationAttemptedAt: params.now,
			historicalReconciliationLeaseOwner: params.leaseOwner,
			historicalReconciliationLeaseExpiresAt: leaseExpiresAt,
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

async function finishRun({ runId, leaseOwner, now }: { runId: string; leaseOwner: string; now: Date }) {
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'historical_reconciliation')))
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
		.where(
			and(eq(syncRun.id, runId), eq(syncRun.slice, 'historical_reconciliation'), eq(syncRun.leaseOwner, leaseOwner)),
		)
}

async function readGenerationResult(runId: string): Promise<HistoricalReconciliationGenerationResult> {
	const [run] = await db.select().from(syncRun).where(eq(syncRun.id, runId)).limit(1)
	if (!run) throw new Error(`Sync run ${runId} not found`)
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'historical_reconciliation')))
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
	return `${runDiagnosticReference(runId)}/historical-reconciliation/${accountId}`
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
		if (isMetaAccessLoss(error)) return 'authorization'
		if (isMetaRateLimit(error)) return 'rate_limit'
		if (error.status >= 500) return 'upstream'
		return 'meta_validation'
	}
	return 'unexpected'
}
