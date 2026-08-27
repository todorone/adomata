import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'

import { logger } from '../core/logger'
import { db } from '../db'
import {
	ad,
	adAccount,
	adCreative,
	adSet,
	campaign,
	client,
	organizationSettings,
	syncAccountOutcome,
	syncInvocation,
	syncRun,
} from '../db/schema'
import { creativeHasVideo } from '../fleet-board/creative'
import { isMetaAccessLoss, isMetaRateLimit, metaThrottleNextDueAt, MetaApiError } from '../meta/client'
import type { MetaClient, MetaCreative, MetaThrottleObservation } from '../meta/client'
import { pruneSyncHistory } from './account-data'
import { priorityForSyncWork, runWithMetaCapacity } from './capacity'

const creativeIntervalMilliseconds = 5 * 60 * 1000
const runLeaseMilliseconds = 60 * 1000
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
	await pruneSyncHistory(now)

	return db.transaction(async transaction => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`)

		const [activeRun] = await transaction
			.select({ id: syncRun.id })
			.from(syncRun)
			.where(
				and(
					eq(syncRun.agencyId, agencyId),
					eq(syncRun.slice, 'creative'),
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
				slice: 'creative',
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
						or(
							lte(adAccount.creativeNextDueAt, now),
							and(isNull(adAccount.creativeSuccessfulAt), isNull(adAccount.creativeAttemptedAt)),
						),
					),
				)
				.orderBy(asc(adAccount.connectionStatus), asc(adAccount.id))

			if (dueAccounts.length > 0) {
				await transaction.insert(syncAccountOutcome).values(
					dueAccounts.map(account => ({
						id: randomUUID(),
						runId,
						adAccountId: account.id,
						slice: 'creative' as const,
						status: 'queued' as const,
						diagnosticReference: creativeDiagnosticReference(runId, account.id),
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
	const results: CreativeGenerationResult[] = []
	for (const agency of agencies) results.push(await scheduleCreativeRun({ ...options, agencyId: agency.id }))
	return results
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
	const leaseExpiresAt = new Date(now.getTime() + runLeaseMilliseconds)
	const claimed = await claimRun({ agencyId, runId, leaseOwner, now, leaseExpiresAt })
	if (!claimed) return await readGenerationResult(runId)

	const outcomes = await db
		.select({ id: syncAccountOutcome.id, connectionStatus: adAccount.connectionStatus })
		.from(syncAccountOutcome)
		.innerJoin(adAccount, eq(syncAccountOutcome.adAccountId, adAccount.id))
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'creative')))
		// Least-recently-attempted first so a resumed generation rotates past the account that
		// exhausted Meta's budget last time instead of stalling on it and starving the rest.
		.orderBy(
			asc(adAccount.connectionStatus),
			sql`${syncAccountOutcome.attemptedAt} asc nulls first`,
			asc(adAccount.id),
		)
	await mapWithConcurrency(outcomes, 1, async outcome => {
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

	await finishRun({ runId, leaseOwner, now: clock() })
	const result = await readGenerationResult(runId)
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
					eq(syncRun.slice, 'creative'),
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
					eq(syncAccountOutcome.slice, 'creative'),
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

async function processOutcome(params: CreativeOutcomeContext) {
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
				eq(syncAccountOutcome.slice, 'creative'),
				eq(syncAccountOutcome.status, 'queued'),
			),
		)
		.returning({ adAccountId: syncAccountOutcome.adAccountId })
	if (!claimed[0]) return false

	await db
		.update(adAccount)
		.set({
			creativeAttemptedAt: params.now,
			creativeLeaseOwner: params.leaseOwner,
			creativeLeaseExpiresAt: leaseExpiresAt,
			updatedAt: params.now,
		})
		.where(eq(adAccount.id, claimed[0].adAccountId))

	const account = await loadAccountForRun(params.agencyId, claimed[0].adAccountId, params.metaMode)
	if (!account) {
		await recordOutcomeFailure(
			params,
			new Error('Ad Account disappeared before Creative work started'),
			claimed[0].adAccountId,
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
		const diagnosticReference = creativeDiagnosticReference(params.runId, account.adAccount.id)

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
	const diagnosticReference = creativeDiagnosticReference(params.runId, accountId)
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
	const diagnosticReference = creativeDiagnosticReference(params.runId, accountId)
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

async function finishRun({ runId, leaseOwner, now }: { runId: string; leaseOwner: string; now: Date }) {
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'creative')))
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
		.where(and(eq(syncRun.id, runId), eq(syncRun.slice, 'creative'), eq(syncRun.leaseOwner, leaseOwner)))
}

async function readGenerationResult(runId: string): Promise<CreativeGenerationResult> {
	const [run] = await db.select().from(syncRun).where(eq(syncRun.id, runId)).limit(1)
	if (!run) throw new Error(`Sync run ${runId} not found`)
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'creative')))
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

function creativeDiagnosticReference(runId: string, accountId: string) {
	return `${runDiagnosticReference(runId)}/creative/${accountId}`
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
