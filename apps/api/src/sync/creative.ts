import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'

import { logger } from '../core/logger'
import { db } from '../db'
import { ad, adAccount, adCreative, adSet, campaign, client, syncAccountOutcome } from '../db/schema'
import { creativeHasVideo } from '../fleet-board/creative'
import { isMetaAccessLoss, metaThrottleNextDueAt, MetaApiError } from '../meta/client'
import type { MetaClient, MetaCreative, MetaThrottleObservation } from '../meta/client'
import { metaCapacityConcurrency, priorityForSyncWork, runWithMetaCapacity } from './capacity'
import {
	claimOutcome,
	claimRun,
	describePollError,
	enqueueDurableRun,
	errorCategory,
	finishRun,
	loadAccountForRun,
	mapWithConcurrency,
	outcomeDiagnosticReference,
	readGenerationResult,
} from './durable-run'

const creativeIntervalMilliseconds = 5 * 60 * 1000
const noTokenMessage = 'No Meta token configured for this Agency'

export type CreativeRunOptions = {
	agencyId: string
	trigger: 'cron' | 'connect' | 'manual'
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now?: Date
	clock?: () => Date
}

export type EnqueuedCreativeRun = {
	runId: string
	invocationId: string
	joined: boolean
}

export type CreativeGenerationResult = {
	runId: string
	status: 'queued' | 'running' | 'completed' | 'failed'
	processed: number
	failed: number
	skipped: number
	queued: number
}

type CreativeOutcomeContext = {
	agencyId: string
	runId: string
	outcomeId: string
	leaseOwner: string
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now: Date
	clock: () => Date
}

export async function enqueueCreativeRun({
	agencyId,
	trigger,
	now = new Date(),
}: Pick<CreativeRunOptions, 'agencyId' | 'trigger' | 'now'>): Promise<EnqueuedCreativeRun> {
	return enqueueDurableRun({
		agencyId,
		trigger,
		slice: 'creative',
		now,
		enqueueOutcomes: async (transaction, runId, queuedAt) => {
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
						or(
							lte(adAccount.creativeNextDueAt, queuedAt),
							and(isNull(adAccount.creativeSuccessfulAt), isNull(adAccount.creativeAttemptedAt)),
						),
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
							slice: 'creative' as const,
							status: 'queued' as const,
							diagnosticReference: outcomeDiagnosticReference(runId, 'creative', account.id),
							createdAt: queuedAt,
							updatedAt: queuedAt,
						})),
					)
					.onConflictDoNothing()
			}
		},
	})
}

export async function scheduleCreativeRun(options: CreativeRunOptions) {
	const enqueued = await enqueueCreativeRun(options)
	const result = await runCreativeGeneration({ ...options, runId: enqueued.runId })
	return { ...enqueued, ...result }
}

export async function scheduleCreativeRunsForAgencies(
	options: Omit<CreativeRunOptions, 'agencyId'>,
): Promise<CreativeGenerationResult[]> {
	const agencies = await db
		.select({ id: client.agencyId })
		.from(adAccount)
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.groupBy(client.agencyId)
	return Promise.all(agencies.map(agency => scheduleCreativeRun({ ...options, agencyId: agency.id })))
}

export async function runCreativeGeneration({
	agencyId,
	runId,
	trigger,
	metaMode,
	buildMetaClient,
	now = new Date(),
	clock = () => new Date(),
}: CreativeRunOptions & { runId: string }): Promise<CreativeGenerationResult> {
	const leaseOwner = randomUUID()
	const claimed = await claimRun({ agencyId, runId, slice: 'creative', leaseOwner, now })
	if (!claimed) return await readGenerationResult(runId, 'creative')

	let stopped = false
	while (!stopped) {
		const outcomes = await db
			.select({ id: syncAccountOutcome.id, connectionStatus: adAccount.connectionStatus })
			.from(syncAccountOutcome)
			.innerJoin(adAccount, eq(syncAccountOutcome.adAccountId, adAccount.id))
			.where(
				and(
					eq(syncAccountOutcome.runId, runId),
					eq(syncAccountOutcome.slice, 'creative'),
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
			return runWithMetaCapacity(priorityForSyncWork(trigger, 'creative', outcome.connectionStatus), () =>
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

	await finishRun({ runId, slice: 'creative', leaseOwner, now: clock() })
	const result = await readGenerationResult(runId, 'creative')
	logger.info('Durable Creative generation completed', {
		agencyId,
		runId,
		status: result.status,
		processed: result.processed,
		failed: result.failed,
		skipped: result.skipped,
	})
	return result
}

async function processOutcome(params: CreativeOutcomeContext) {
	const claimed = await claimOutcome({
		runId: params.runId,
		outcomeId: params.outcomeId,
		slice: 'creative',
		leaseOwner: params.leaseOwner,
		now: params.now,
	})
	if (!claimed) return false

	await db
		.update(adAccount)
		.set({
			creativeAttemptedAt: params.now,
			creativeLeaseOwner: params.leaseOwner,
			creativeLeaseExpiresAt: claimed.leaseExpiresAt,
			updatedAt: params.now,
		})
		.where(eq(adAccount.id, claimed.adAccountId))

	const account = await loadAccountForRun(params.agencyId, claimed.adAccountId, params.metaMode)
	if (!account) {
		await recordOutcomeFailure(
			params,
			new Error('Ad Account disappeared before Creative work started'),
			claimed.adAccountId,
		)
		return false
	}

	try {
		if (params.metaMode === 'live' && !account.metaAccessToken) {
			await recordOutcomeSkipped(params, account.adAccount.id)
			return false
		}

		const ads = await db
			.select({ id: ad.id })
			.from(ad)
			.innerJoin(adSet, eq(ad.adSetId, adSet.id))
			.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
			.where(and(eq(campaign.adAccountId, account.adAccount.id), isNull(ad.deletedAt)))
		const metaClient = params.buildMetaClient(account.metaAccessToken ?? undefined)
		const results: Array<{ creative: MetaCreative | null; error: unknown }> = []
		for (const row of ads) {
			try {
				const creative = await metaClient.getCreative(row.id, account.adAccount.id)
				results.push({ creative, error: null })
				if (creative && (creative.throttle.appExhausted || creative.throttle.accountExhausted)) {
					await releaseOutcome(params, account.adAccount.id, creative.throttle)
					return creative.throttle.appExhausted
				}
			} catch (error) {
				results.push({ creative: null, error })
				if (
					error instanceof MetaApiError &&
					error.throttle &&
					(error.throttle.appExhausted || error.throttle.accountExhausted)
				) {
					await releaseOutcome(params, account.adAccount.id, error.throttle)
					return error.throttle.appExhausted
				}
			}
		}
		const failures = results.filter(result => result.error !== null)
		const accessLost = failures.some(result => isMetaAccessLoss(result.error))
		const committedAt = params.clock()
		const diagnosticReference = outcomeDiagnosticReference(params.runId, 'creative', account.adAccount.id)

		await db.transaction(async transaction => {
			for (const result of results) {
				if (!result.creative) continue
				await upsertCreative(transaction, result.creative, committedAt)
			}
			const outcome = await transaction
				.update(syncAccountOutcome)
				.set({
					status: failures.length === 0 ? 'succeeded' : 'failed',
					leaseOwner: null,
					leaseExpiresAt: null,
					completedAt: committedAt,
					successfulCommitAt: failures.length === 0 ? committedAt : null,
					diagnosticReference,
					error: failures.length === 0 ? null : describePollError(failures[0]!.error),
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
			await transaction
				.update(adAccount)
				.set({
					...(accessLost ? { connectionStatus: 'access_lost' as const } : {}),
					creativeAttemptedAt: committedAt,
					...(failures.length === 0
						? {
								creativeSuccessfulAt: committedAt,
								creativeError: null,
							}
						: { creativeError: describePollError(failures[0]!.error) }),
					creativeDiagnosticReference: diagnosticReference,
					creativeNextDueAt: new Date(committedAt.getTime() + creativeIntervalMilliseconds),
					creativeLeaseOwner: null,
					creativeLeaseExpiresAt: null,
					updatedAt: committedAt,
				})
				.where(eq(adAccount.id, account.adAccount.id))
		})
		if (failures.length > 0) {
			logger.warn('Durable Creative enrichment partially failed', {
				agencyId: params.agencyId,
				runId: params.runId,
				accountId: account.adAccount.id,
				failedAds: failures.length,
			})
		}
		return false
	} catch (error) {
		await recordOutcomeFailure(params, error, account.adAccount.id)
		return error instanceof MetaApiError && error.throttle?.appExhausted === true
	}
}

async function releaseOutcome(params: CreativeOutcomeContext, accountId: string, throttle: MetaThrottleObservation) {
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
			creativeNextDueAt: metaThrottleNextDueAt(throttle, occurredAt, creativeIntervalMilliseconds),
			creativeLeaseOwner: null,
			creativeLeaseExpiresAt: null,
			updatedAt: occurredAt,
		})
		.where(eq(adAccount.id, accountId))
}

async function upsertCreative(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	creative: MetaCreative,
	now: Date,
) {
	await transaction
		.insert(adCreative)
		.values({
			id: creative.id,
			adId: creative.adId,
			name: creative.name,
			payload: creative.payload,
			hasVideo: creativeHasVideo(creative.payload),
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: adCreative.id,
			set: {
				adId: creative.adId,
				name: creative.name,
				payload: creative.payload,
				hasVideo: creativeHasVideo(creative.payload),
				updatedAt: now,
			},
		})
}

async function recordOutcomeSkipped(params: CreativeOutcomeContext, accountId: string) {
	const occurredAt = params.clock()
	const diagnosticReference = outcomeDiagnosticReference(params.runId, 'creative', accountId)
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
				creativeAttemptedAt: occurredAt,
				creativeError: noTokenMessage,
				creativeDiagnosticReference: diagnosticReference,
				creativeNextDueAt: new Date(occurredAt.getTime() + creativeIntervalMilliseconds),
				creativeLeaseOwner: null,
				creativeLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
}

async function recordOutcomeFailure(params: CreativeOutcomeContext, error: unknown, accountId: string) {
	const message = describePollError(error)
	const diagnosticReference = outcomeDiagnosticReference(params.runId, 'creative', accountId)
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
				creativeAttemptedAt: occurredAt,
				creativeError: message,
				creativeDiagnosticReference: diagnosticReference,
				creativeNextDueAt: metaThrottleNextDueAt(
					error instanceof MetaApiError ? error.throttle : undefined,
					occurredAt,
					creativeIntervalMilliseconds,
				),
				creativeLeaseOwner: null,
				creativeLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
	logger.warn('Durable Creative sync failed', {
		agencyId: params.agencyId,
		runId: params.runId,
		outcomeId: params.outcomeId,
		category: errorCategory(error),
	})
}
