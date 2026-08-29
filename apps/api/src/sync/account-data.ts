import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import { logger } from '../core/logger'
import { db } from '../db'
import { adAccount, client, syncAccountOutcome } from '../db/schema'
import { isMetaAccessLoss, metaThrottleNextDueAt, MetaApiError } from '../meta/client'
import type { MetaClient, MetaThrottleObservation } from '../meta/client'
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
	type DurableGenerationResult,
	type DurableRunOptions,
	type EnqueuedDurableRun,
} from './durable-run'

const accountDataIntervalMilliseconds = 5 * 60 * 1000
const noTokenMessage = 'No Meta token configured for this Agency'

export type AccountDataRunOptions = DurableRunOptions & {
	force?: boolean
	forceRefreshId?: string
	onAccountSynchronized?: (accountId: string) => void
}

export type EnqueuedAccountDataRun = EnqueuedDurableRun

export type AccountDataGenerationResult = DurableGenerationResult

type AccountDataOutcomeContext = {
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

export async function enqueueAccountDataRun({
	agencyId,
	trigger,
	force = false,
	forceRefreshId,
	now = new Date(),
}: Pick<
	AccountDataRunOptions,
	'agencyId' | 'trigger' | 'force' | 'forceRefreshId' | 'now'
>): Promise<EnqueuedAccountDataRun> {
	return enqueueDurableRun({
		agencyId,
		trigger,
		slice: 'account_data',
		forceRefreshId,
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
						...(force
							? []
							: [
									or(
										lte(adAccount.accountDataNextDueAt, queuedAt),
										and(isNull(adAccount.accountDataSuccessfulAt), isNull(adAccount.accountDataAttemptedAt)),
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
							slice: 'account_data' as const,
							status: 'queued' as const,
							diagnosticReference: outcomeDiagnosticReference(runId, 'account_data', account.id),
							createdAt: queuedAt,
							updatedAt: queuedAt,
						})),
					)
					.onConflictDoNothing()
			}
		},
	})
}

export async function scheduleAccountDataRun(options: AccountDataRunOptions) {
	const enqueued = await enqueueAccountDataRun(options)
	const result = await runAccountDataGeneration({ ...options, runId: enqueued.runId })
	return { ...enqueued, ...result }
}

export async function runAccountDataGeneration({
	agencyId,
	runId,
	trigger,
	metaMode,
	buildMetaClient,
	now = new Date(),
	clock = () => new Date(),
	onAccountSynchronized,
}: AccountDataRunOptions & { runId: string }): Promise<AccountDataGenerationResult> {
	const leaseOwner = randomUUID()
	const claimed = await claimRun({ agencyId, runId, slice: 'account_data', leaseOwner, now })
	if (!claimed) return await readGenerationResult(runId, 'account_data')

	let stopped = false
	while (!stopped) {
		const outcomes = await db
			.select({ id: syncAccountOutcome.id, connectionStatus: adAccount.connectionStatus })
			.from(syncAccountOutcome)
			.innerJoin(adAccount, eq(syncAccountOutcome.adAccountId, adAccount.id))
			.where(
				and(
					eq(syncAccountOutcome.runId, runId),
					eq(syncAccountOutcome.slice, 'account_data'),
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
			return runWithMetaCapacity(priorityForSyncWork(trigger, 'account_data', outcome.connectionStatus), () =>
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

	await finishRun({ runId, slice: 'account_data', leaseOwner, now })
	import('./runtime').then(({ triggerPendingForceRefreshes }) => triggerPendingForceRefreshes()).catch(() => undefined)
	const result = await readGenerationResult(runId, 'account_data')
	logger.info('Durable Account data generation completed', {
		agencyId,
		runId,
		status: result.status,
		processed: result.processed,
		failed: result.failed,
		skipped: result.skipped,
	})
	return result
}

export async function scheduleAccountDataRunsForAgencies(
	options: Omit<AccountDataRunOptions, 'agencyId'>,
): Promise<AccountDataGenerationResult[]> {
	const agencies = await db
		.select({ id: client.agencyId })
		.from(adAccount)
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.groupBy(client.agencyId)
	return Promise.all(agencies.map(agency => scheduleAccountDataRun({ ...options, agencyId: agency.id })))
}

export { pruneSyncHistory } from './durable-run'

async function processOutcome(params: AccountDataOutcomeContext) {
	const claimed = await claimOutcome({
		runId: params.runId,
		outcomeId: params.outcomeId,
		slice: 'account_data',
		leaseOwner: params.leaseOwner,
		now: params.now,
	})
	// The return value means "Meta's budget is gone, stop the run". An outcome a previous
	// generation already finished is not that signal: reporting it as one halts every account
	// behind it, and since the run then never leaves 'running' the slice wedges for good.
	if (!claimed) return false

	const account = await loadAccountForRun(params.agencyId, claimed.adAccountId, params.metaMode)

	if (!account) {
		await recordOutcomeFailure(
			params,
			new Error('Ad Account disappeared before Account data work started'),
			claimed.adAccountId,
		)
		return false
	}

	try {
		if (params.metaMode === 'live' && !account.metaAccessToken) {
			await recordOutcomeSkipped(params, account.adAccount.id)
			return false
		}
		const accountData = await params
			.buildMetaClient(account.metaAccessToken ?? undefined)
			.getAccount(account.adAccount.id)
		if (accountData.throttle.accountExhausted && !accountData.throttle.appExhausted) {
			await recordOutcomeThrottled(params, account.adAccount.id, accountData.throttle)
			return false
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
					diagnosticReference: outcomeDiagnosticReference(params.runId, 'account_data', account.adAccount.id),
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

			await transaction
				.update(adAccount)
				.set({
					name: accountData.name,
					currency: accountData.currency,
					timezoneName: accountData.timezoneName,
					connectionStatus: account.adAccount.connectionStatus,
					metaAccountStatus: accountData.metaAccountStatus,
					metaDisableReason: accountData.metaDisableReason,
					balance: accountData.balance,
					isPrepayAccount: accountData.isPrepayAccount,
					fundingSourceType: accountData.fundingSourceType,
					accountDataAttemptedAt: committedAt,
					accountDataSuccessfulAt: committedAt,
					accountDataError: null,
					accountDataDiagnosticReference: null,
					accountDataMetaErrorCode: null,
					accountDataNextDueAt: metaThrottleNextDueAt(
						accountData.throttle,
						committedAt,
						accountDataIntervalMilliseconds,
					),
					accountDataLeaseOwner: null,
					accountDataLeaseExpiresAt: null,
					updatedAt: committedAt,
				})
				.where(eq(adAccount.id, account.adAccount.id))
		})
		params.onAccountSynchronized?.(account.adAccount.id)
		return accountData.throttle.appExhausted
	} catch (error) {
		await recordOutcomeFailure(params, error, account.adAccount.id)
		return error instanceof MetaApiError && error.throttle?.appExhausted === true
	}
}

async function recordOutcomeSkipped(params: AccountDataOutcomeContext, accountId: string) {
	const occurredAt = params.clock()
	const diagnosticReference = outcomeDiagnosticReference(params.runId, 'account_data', accountId)
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
				accountDataAttemptedAt: occurredAt,
				accountDataError: noTokenMessage,
				accountDataDiagnosticReference: diagnosticReference,
				accountDataMetaErrorCode: null,
				accountDataNextDueAt: new Date(occurredAt.getTime() + accountDataIntervalMilliseconds),
				accountDataLeaseOwner: null,
				accountDataLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
}

async function recordOutcomeThrottled(
	params: AccountDataOutcomeContext,
	accountId: string,
	throttle: MetaThrottleObservation,
) {
	const occurredAt = params.clock()
	const diagnosticReference = outcomeDiagnosticReference(params.runId, 'account_data', accountId)
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
				accountDataAttemptedAt: occurredAt,
				accountDataError: 'Meta throttle budget exhausted',
				accountDataDiagnosticReference: diagnosticReference,
				accountDataMetaErrorCode: null,
				accountDataNextDueAt: metaThrottleNextDueAt(throttle, occurredAt, accountDataIntervalMilliseconds),
				accountDataLeaseOwner: null,
				accountDataLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
}

async function recordOutcomeFailure(params: AccountDataOutcomeContext, error: unknown, accountId: string) {
	const message = describePollError(error)
	const diagnosticReference = outcomeDiagnosticReference(params.runId, 'account_data', accountId)
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
				accountDataAttemptedAt: occurredAt,
				accountDataError: message,
				accountDataDiagnosticReference: diagnosticReference,
				accountDataMetaErrorCode: error instanceof MetaApiError ? (error.code ?? null) : null,
				accountDataNextDueAt: metaThrottleNextDueAt(
					error instanceof MetaApiError ? error.throttle : undefined,
					occurredAt,
					accountDataIntervalMilliseconds,
				),
				accountDataLeaseOwner: null,
				accountDataLeaseExpiresAt: null,
				updatedAt: occurredAt,
			})
			.where(eq(adAccount.id, accountId))
	})
	logger.warn('Durable Account data sync failed', {
		agencyId: params.agencyId,
		runId: params.runId,
		outcomeId: params.outcomeId,
		category: errorCategory(error),
	})
}
