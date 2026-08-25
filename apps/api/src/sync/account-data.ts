import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNull, isNotNull, lte, or, sql } from 'drizzle-orm'

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
import { isMetaAccessLoss, MetaApiError } from '../meta/client'
import type { MetaClient } from '../meta/client'

const accountDataIntervalMilliseconds = 5 * 60 * 1000
const runLeaseMilliseconds = 60 * 1000
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
		await initializeAccountDataFreshness(transaction, agencyId, now)

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

		const runId = activeRun?.id ?? randomUUID()
		const joined = Boolean(activeRun)
		if (activeRun && forceRefreshId) {
			await transaction.update(syncRun).set({ forceRefreshId, updatedAt: now }).where(eq(syncRun.id, activeRun.id))
		}
		if (!activeRun) {
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
							: [or(isNull(adAccount.accountDataSuccessfulAt), lte(adAccount.accountDataNextDueAt, now))]),
					),
				)
				.orderBy(asc(adAccount.connectionStatus), asc(adAccount.id))

			if (dueAccounts.length > 0) {
				await transaction.insert(syncAccountOutcome).values(
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

export async function scheduleAccountDataRun(options: AccountDataRunOptions) {
	const enqueued = await enqueueAccountDataRun(options)
	const result = await runAccountDataGeneration({ ...options, runId: enqueued.runId })
	return { ...enqueued, ...result }
}

export async function runAccountDataGeneration({
	agencyId,
	runId,
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

	const outcomes = await db
		.select({ id: syncAccountOutcome.id })
		.from(syncAccountOutcome)
		.innerJoin(adAccount, eq(syncAccountOutcome.adAccountId, adAccount.id))
		.where(eq(syncAccountOutcome.runId, runId))
		.orderBy(asc(adAccount.connectionStatus), asc(adAccount.id))
	await mapWithConcurrency(outcomes, 1, async outcome => {
		return processOutcome({
			agencyId,
			runId,
			outcomeId: outcome.id,
			leaseOwner,
			metaMode,
			buildMetaClient,
			now,
			clock,
			onAccountSynchronized,
		})
	})

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
	const results: AccountDataGenerationResult[] = []
	for (const agency of agencies) {
		const result = await scheduleAccountDataRun({ ...options, agencyId: agency.id })
		results.push(result)
	}
	return results
}

export async function pruneSyncHistory(now = new Date()) {
	const cutoff = new Date(now.getTime() - historyRetentionMilliseconds)
	await db.delete(syncInvocation).where(lte(syncInvocation.createdAt, cutoff))
	await db.delete(syncRun).where(lte(syncRun.createdAt, cutoff))
	await db.delete(forceRefresh).where(lte(forceRefresh.createdAt, cutoff))
}

async function initializeAccountDataFreshness(
	transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
	agencyId: string,
	now: Date,
) {
	await transaction
		.update(adAccount)
		.set({
			accountDataSuccessfulAt: sql`${adAccount.accountTierRefreshedAt}`,
			accountDataNextDueAt: now,
		})
		.from(client)
		.where(
			and(
				eq(adAccount.clientId, client.id),
				eq(client.agencyId, agencyId),
				isNull(adAccount.accountDataSuccessfulAt),
				isNotNull(adAccount.accountTierRefreshedAt),
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
	if (!claimed[0]) return true

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
					accountTierRefreshedAt: committedAt,
					accountDataAttemptedAt: committedAt,
					accountDataSuccessfulAt: committedAt,
					accountDataError: null,
					accountDataDiagnosticReference: null,
					accountDataNextDueAt: new Date(committedAt.getTime() + accountDataIntervalMilliseconds),
					accountDataLeaseOwner: null,
					accountDataLeaseExpiresAt: null,
					lastPollAttemptAt: committedAt,
					lastPollError: null,
					updatedAt: committedAt,
				})
				.where(eq(adAccount.id, account.adAccount.id))
		})
		params.onAccountSynchronized?.(account.adAccount.id)
		return accountData.throttle.exhausted
	} catch (error) {
		await recordOutcomeFailure(params, error, account.adAccount.id)
		return error instanceof MetaApiError && error.throttle?.exhausted === true
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
				accountDataNextDueAt: new Date(occurredAt.getTime() + accountDataIntervalMilliseconds),
				accountDataLeaseOwner: null,
				accountDataLeaseExpiresAt: null,
				lastPollAttemptAt: occurredAt,
				lastPollError: noTokenMessage,
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
				accountDataNextDueAt: new Date(occurredAt.getTime() + accountDataIntervalMilliseconds),
				accountDataLeaseOwner: null,
				accountDataLeaseExpiresAt: null,
				lastPollAttemptAt: occurredAt,
				lastPollError: message,
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
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(eq(syncAccountOutcome.runId, runId))
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
		.where(and(eq(syncRun.id, runId), eq(syncRun.leaseOwner, leaseOwner)))
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
		if (error.code === 4 || error.status === 429) return 'rate_limit'
		if (error.status >= 500) return 'upstream'
		return 'meta_validation'
	}
	return 'unexpected'
}
