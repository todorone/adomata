import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNull, lte, notExists, or, sql } from 'drizzle-orm'

import { logger } from '../core/logger'
import { db } from '../db'
import {
	adAccount,
	client,
	forceRefresh,
	organizationSettings,
	syncAccountOutcome,
	syncInvocation,
	syncRun,
} from '../db/schema'
import { isMetaAccessLoss, isMetaRateLimit, metaThrottleNextDueAt, MetaApiError } from '../meta/client'
import type { MetaClient, MetaThrottleObservation } from '../meta/client'
import { metaCapacityConcurrency, priorityForSyncWork, runWithMetaCapacity } from './capacity'

const accountDataIntervalMilliseconds = 5 * 60 * 1000
const runLeaseMilliseconds = 60 * 1000
const runMaximumActiveMilliseconds = 5 * 60 * 1000
const historyRetentionMilliseconds = 30 * 24 * 60 * 60 * 1000
const noTokenMessage = 'No Meta token configured for this Agency'

export type AccountDataRunOptions = {
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

export type EnqueuedAccountDataRun = {
	runId: string
	invocationId: string
	joined: boolean
}

export type AccountDataGenerationResult = {
	runId: string
	status: 'queued' | 'running' | 'completed' | 'failed'
	processed: number
	failed: number
	skipped: number
	queued: number
}

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
	await pruneSyncHistory(now)

	return db.transaction(async transaction => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`)
		await transaction
			.update(syncRun)
			.set({ status: 'failed', leaseOwner: null, leaseExpiresAt: null, completedAt: now, updatedAt: now })
			.where(
				and(
					eq(syncRun.agencyId, agencyId),
					eq(syncRun.slice, 'account_data'),
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
					eq(syncRun.slice, 'account_data'),
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
				slice: 'account_data',
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
									lte(adAccount.accountDataNextDueAt, now),
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
						diagnosticReference: accountDiagnosticReference(runId, account.id),
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
	const leaseExpiresAt = new Date(now.getTime() + runLeaseMilliseconds)
	const claimed = await claimRun({ agencyId, runId, leaseOwner, now, leaseExpiresAt })
	if (!claimed) return await readGenerationResult(runId)

	let stopped = false
	while (!stopped) {
		const outcomes = await db
			.select({ id: syncAccountOutcome.id, connectionStatus: adAccount.connectionStatus })
			.from(syncAccountOutcome)
			.innerJoin(adAccount, eq(syncAccountOutcome.adAccountId, adAccount.id))
			.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.status, 'queued')))
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

	await finishRun({ runId, leaseOwner, now })
	import('./runtime').then(({ triggerPendingForceRefreshes }) => triggerPendingForceRefreshes()).catch(() => undefined)
	const result = await readGenerationResult(runId)
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

export async function pruneSyncHistory(now = new Date()) {
	const cutoff = new Date(now.getTime() - historyRetentionMilliseconds)
	await db.delete(syncInvocation).where(lte(syncInvocation.createdAt, cutoff))
	await db.delete(syncRun).where(lte(syncRun.createdAt, cutoff))
	await db
		.delete(forceRefresh)
		.where(
			and(
				lte(forceRefresh.createdAt, cutoff),
				notExists(db.select({ id: syncRun.id }).from(syncRun).where(eq(syncRun.forceRefreshId, forceRefresh.id))),
			),
		)
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

async function processOutcome(params: AccountDataOutcomeContext) {
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
				eq(syncAccountOutcome.status, 'queued'),
			),
		)
		.returning({ adAccountId: syncAccountOutcome.adAccountId })
	// The return value means "Meta's budget is gone, stop the run". An outcome a previous
	// generation already finished is not that signal: reporting it as one halts every account
	// behind it, and since the run then never leaves 'running' the slice wedges for good.
	if (!claimed[0]) return false

	const account = await loadAccountForRun(params.agencyId, claimed[0].adAccountId, params.metaMode)

	if (!account) {
		await recordOutcomeFailure(
			params,
			new Error('Ad Account disappeared before Account data work started'),
			claimed[0].adAccountId,
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
					diagnosticReference: accountDiagnosticReference(params.runId, account.adAccount.id),
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
	const diagnosticReference = accountDiagnosticReference(params.runId, accountId)
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
	const diagnosticReference = accountDiagnosticReference(params.runId, accountId)
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
	const diagnosticReference = accountDiagnosticReference(params.runId, accountId)
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

async function finishRun({ runId, leaseOwner, now }: { runId: string; leaseOwner: string; now: Date }) {
	await db.transaction(async transaction => {
		const [run] = await transaction
			.update(syncRun)
			.set({ updatedAt: now })
			.where(and(eq(syncRun.id, runId), eq(syncRun.leaseOwner, leaseOwner)))
			.returning({ id: syncRun.id })
		if (!run) return

		const outcomes = await transaction
			.select({ status: syncAccountOutcome.status })
			.from(syncAccountOutcome)
			.where(eq(syncAccountOutcome.runId, runId))
		const status = outcomes.some(outcome => outcome.status === 'queued' || outcome.status === 'running')
			? 'running'
			: outcomes.some(outcome => outcome.status === 'failed')
				? 'failed'
				: 'completed'
		await transaction
			.update(syncRun)
			.set({
				status,
				leaseOwner: status === 'running' ? leaseOwner : null,
				leaseExpiresAt: status === 'running' ? new Date(now.getTime() + runLeaseMilliseconds) : null,
				completedAt: status === 'running' ? null : now,
				updatedAt: now,
			})
			.where(eq(syncRun.id, runId))
	})
}

async function readGenerationResult(runId: string): Promise<AccountDataGenerationResult> {
	const [run] = await db.select().from(syncRun).where(eq(syncRun.id, runId)).limit(1)
	if (!run) throw new Error(`Sync run ${runId} not found`)
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(eq(syncAccountOutcome.runId, runId))
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
	return stopped
}

function runDiagnosticReference(runId: string) {
	return `sync-run/${runId}`
}

function accountDiagnosticReference(runId: string, accountId: string) {
	return `${runDiagnosticReference(runId)}/account-data/${accountId}`
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
