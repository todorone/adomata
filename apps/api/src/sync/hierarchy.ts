import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import { logger } from '../core/logger'
import { db } from '../db'
import { ad, adAccount, adSet, campaign, client, syncAccountOutcome, syncInvocation, syncRun } from '../db/schema'
import {
	isMetaAccessLoss,
	metaThrottleNextDueAt,
	MetaApiError,
	type MetaClient,
	type MetaThrottleObservation,
} from '../meta/client'
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

const hierarchyIntervalMilliseconds = 5 * 60 * 1000
const runMaximumActiveMilliseconds = 5 * 60 * 1000
const noTokenMessage = 'No Meta token configured for this Agency'

export type HierarchyRunOptions = {
	agencyId: string
	trigger: 'cron' | 'connect' | 'manual'
	force?: boolean
	forceRefreshId?: string
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now?: Date
	clock?: () => Date
	onAccountSynchronized?: (accountId: string) => void
}

export type EnqueuedHierarchyRun = {
	runId: string
	invocationId: string
	joined: boolean
}

export type HierarchyGenerationResult = {
	runId: string
	status: 'queued' | 'running' | 'completed' | 'failed'
	processed: number
	failed: number
	skipped: number
	queued: number
}

type HierarchyOutcomeContext = {
	agencyId: string
	runId: string
	outcomeId: string
	leaseOwner: string
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now: Date
	clock: () => Date
	onAccountSynchronized?: (accountId: string) => void
}

export async function enqueueHierarchyRun({
	agencyId,
	trigger,
	force = false,
	forceRefreshId,
	now = new Date(),
}: Pick<
	HierarchyRunOptions,
	'agencyId' | 'trigger' | 'force' | 'forceRefreshId' | 'now'
>): Promise<EnqueuedHierarchyRun> {
	await pruneSyncHistory(now)

	return db.transaction(async transaction => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`)
		await transaction
			.update(syncRun)
			.set({ status: 'failed', leaseOwner: null, leaseExpiresAt: null, completedAt: now, updatedAt: now })
			.where(
				and(
					eq(syncRun.agencyId, agencyId),
					eq(syncRun.slice, 'hierarchy'),
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
					eq(syncRun.slice, 'hierarchy'),
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
				slice: 'hierarchy',
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
					...(force
						? []
						: [
								or(
									lte(adAccount.hierarchyNextDueAt, now),
									and(isNull(adAccount.hierarchySuccessfulAt), isNull(adAccount.hierarchyAttemptedAt)),
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
						slice: 'hierarchy' as const,
						status: 'queued' as const,
						diagnosticReference: hierarchyDiagnosticReference(runId, account.id),
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

export async function scheduleHierarchyRun(options: HierarchyRunOptions) {
	const enqueued = await enqueueHierarchyRun(options)
	const result = await runHierarchyGeneration({ ...options, runId: enqueued.runId })
	return { ...enqueued, ...result }
}

export async function scheduleHierarchyRunsForAgencies(
	options: Omit<HierarchyRunOptions, 'agencyId'>,
): Promise<HierarchyGenerationResult[]> {
	const agencies = await db
		.select({ id: client.agencyId })
		.from(adAccount)
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.groupBy(client.agencyId)
	return Promise.all(agencies.map(agency => scheduleHierarchyRun({ ...options, agencyId: agency.id })))
}

export async function runHierarchyGeneration({
	agencyId,
	runId,
	trigger,
	metaMode,
	buildMetaClient,
	now = new Date(),
	clock = () => new Date(),
	onAccountSynchronized,
}: HierarchyRunOptions & { runId: string }): Promise<HierarchyGenerationResult> {
	const leaseOwner = randomUUID()
	const claimed = await claimRun({ agencyId, runId, slice: 'hierarchy', leaseOwner, now })
	if (!claimed) return await readGenerationResult(runId, 'hierarchy')

	let stopped = false
	while (!stopped) {
		const outcomes = await db
			.select({ id: syncAccountOutcome.id, connectionStatus: adAccount.connectionStatus })
			.from(syncAccountOutcome)
			.innerJoin(adAccount, eq(syncAccountOutcome.adAccountId, adAccount.id))
			.where(
				and(
					eq(syncAccountOutcome.runId, runId),
					eq(syncAccountOutcome.slice, 'hierarchy'),
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
			return runWithMetaCapacity(priorityForSyncWork(trigger, 'hierarchy', outcome.connectionStatus), () =>
				processOutcome({
					agencyId,
					runId,
					outcomeId: outcome.id,
					leaseOwner,
					metaMode,
					buildMetaClient,
					now,
					clock,
					onAccountSynchronized,
				}),
			)
		})
	}

	await finishRun({ runId, slice: 'hierarchy', leaseOwner, now })
	import('./runtime').then(({ triggerPendingForceRefreshes }) => triggerPendingForceRefreshes()).catch(() => undefined)
	const result = await readGenerationResult(runId, 'hierarchy')
	logger.info('Durable hierarchy generation completed', {
		agencyId,
		runId,
		status: result.status,
		processed: result.processed,
		failed: result.failed,
		skipped: result.skipped,
	})
	return result
}

async function processOutcome(params: HierarchyOutcomeContext) {
	const claimed = await claimOutcome({
		runId: params.runId,
		outcomeId: params.outcomeId,
		slice: 'hierarchy',
		leaseOwner: params.leaseOwner,
		now: params.now,
	})
	// The return value means "Meta's budget is gone, stop the run". An outcome a previous
	// generation already finished is not that signal: reporting it as one halts every account
	// behind it, and since the run then never leaves 'running' the slice wedges for good.
	if (!claimed) return false

	await db
		.update(adAccount)
		.set({
			hierarchyAttemptedAt: params.now,
			hierarchyLeaseOwner: params.leaseOwner,
			hierarchyLeaseExpiresAt: claimed.leaseExpiresAt,
			updatedAt: params.now,
		})
		.where(eq(adAccount.id, claimed.adAccountId))

	const account = await loadAccountForRun(params.agencyId, claimed.adAccountId, params.metaMode)
	if (!account) {
		await recordOutcomeFailure(
			params,
			new Error('Ad Account disappeared before hierarchy work started'),
			claimed.adAccountId,
		)
		return false
	}

	try {
		if (params.metaMode === 'live' && !account.metaAccessToken) {
			await recordOutcomeSkipped(params, account.adAccount.id)
			return false
		}

		const metaClient = params.buildMetaClient(account.metaAccessToken ?? undefined)
		const campaigns = await metaClient.listCampaigns(account.adAccount.id)
		if (campaigns.throttle.appExhausted || campaigns.throttle.accountExhausted) {
			await releaseOutcome(params, account.adAccount.id, campaigns.throttle)
			return campaigns.throttle.appExhausted
		}
		const adSets = await metaClient.listAdSets(account.adAccount.id)
		if (adSets.throttle.appExhausted || adSets.throttle.accountExhausted) {
			await releaseOutcome(params, account.adAccount.id, adSets.throttle)
			return adSets.throttle.appExhausted
		}
		const ads = await metaClient.listAds(account.adAccount.id)
		if (!ads.complete) {
			await releaseOutcome(params, account.adAccount.id, ads.throttle)
			return ads.throttle.appExhausted
		}

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
					diagnosticReference: hierarchyDiagnosticReference(params.runId, account.adAccount.id),
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

			for (const item of campaigns.items) {
				await transaction
					.insert(campaign)
					.values({
						id: item.id,
						adAccountId: account.adAccount.id,
						name: item.name,
						effectiveStatus: item.effectiveStatus,
						objective: item.objective,
						deletedAt: null,
						updatedAt: committedAt,
					})
					.onConflictDoUpdate({
						target: campaign.id,
						set: {
							adAccountId: account.adAccount.id,
							name: item.name,
							effectiveStatus: item.effectiveStatus,
							objective: item.objective,
							deletedAt: null,
							updatedAt: committedAt,
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
						updatedAt: committedAt,
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
							updatedAt: committedAt,
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
						updatedAt: committedAt,
					})
					.onConflictDoUpdate({
						target: ad.id,
						set: {
							adSetId: item.adSetId,
							name: item.name,
							effectiveStatus: item.effectiveStatus,
							deletedAt: null,
							updatedAt: committedAt,
						},
					})
			}

			await softDeleteMissingHierarchy(
				transaction,
				account.adAccount.id,
				campaigns.items.map(item => item.id),
				adSets.items.map(item => item.id),
				ads.items.map(item => item.id),
				committedAt,
			)

			await transaction
				.update(adAccount)
				.set({
					hierarchySuccessfulAt: committedAt,
					hierarchyError: null,
					hierarchyDiagnosticReference: hierarchyDiagnosticReference(params.runId, account.adAccount.id),
					hierarchyMetaErrorCode: null,
					hierarchyNextDueAt: metaThrottleNextDueAt(ads.throttle, committedAt, hierarchyIntervalMilliseconds),
					hierarchyLeaseOwner: null,
					hierarchyLeaseExpiresAt: null,
					updatedAt: committedAt,
				})
				.where(eq(adAccount.id, account.adAccount.id))
		})
		params.onAccountSynchronized?.(account.adAccount.id)
		return ads.throttle.appExhausted
	} catch (error) {
		await recordOutcomeFailure(params, error, account.adAccount.id)
		return error instanceof MetaApiError && error.throttle?.appExhausted === true
	}
}

async function releaseOutcome(params: HierarchyOutcomeContext, accountId: string, throttle: MetaThrottleObservation) {
	const occurredAt = params.clock()
	await db
		.update(syncAccountOutcome)
		.set({
			status: throttle.appExhausted ? 'queued' : 'skipped',
			leaseOwner: null,
			leaseExpiresAt: null,
			completedAt: throttle.appExhausted ? null : occurredAt,
			updatedAt: occurredAt,
		})
		.where(
			and(
				eq(syncAccountOutcome.id, params.outcomeId),
				eq(syncAccountOutcome.leaseOwner, params.leaseOwner),
				eq(syncAccountOutcome.status, 'running'),
			),
		)
	await db
		.update(adAccount)
		.set({
			hierarchyNextDueAt: metaThrottleNextDueAt(throttle, occurredAt, hierarchyIntervalMilliseconds),
			hierarchyLeaseOwner: null,
			hierarchyLeaseExpiresAt: null,
			updatedAt: occurredAt,
		})
		.where(eq(adAccount.id, accountId))
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

async function recordOutcomeSkipped(params: HierarchyOutcomeContext, accountId: string) {
	const occurredAt = params.clock()
	const diagnosticReference = hierarchyDiagnosticReference(params.runId, accountId)
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
				hierarchyAttemptedAt: occurredAt,
				hierarchyError: noTokenMessage,
				hierarchyDiagnosticReference: diagnosticReference,
				hierarchyMetaErrorCode: null,
				hierarchyNextDueAt: new Date(occurredAt.getTime() + hierarchyIntervalMilliseconds),
				hierarchyLeaseOwner: null,
				hierarchyLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
}

async function recordOutcomeFailure(params: HierarchyOutcomeContext, error: unknown, accountId: string) {
	const message = describePollError(error)
	const diagnosticReference = hierarchyDiagnosticReference(params.runId, accountId)
	const accessLost = isMetaAccessLoss(error)
	const occurredAt = params.clock()
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
				hierarchyAttemptedAt: occurredAt,
				hierarchyError: message,
				hierarchyDiagnosticReference: diagnosticReference,
				hierarchyMetaErrorCode: error instanceof MetaApiError ? (error.code ?? null) : null,
				hierarchyNextDueAt: metaThrottleNextDueAt(
					error instanceof MetaApiError ? error.throttle : undefined,
					occurredAt,
					hierarchyIntervalMilliseconds,
				),
				hierarchyLeaseOwner: null,
				hierarchyLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
	logger.warn('Durable hierarchy sync failed', {
		agencyId: params.agencyId,
		runId: params.runId,
		outcomeId: params.outcomeId,
		category: errorCategory(error),
	})
}

function runDiagnosticReference(runId: string) {
	return `sync-run/${runId}`
}

function hierarchyDiagnosticReference(runId: string, accountId: string) {
	return outcomeDiagnosticReference(runId, 'hierarchy', accountId)
}
