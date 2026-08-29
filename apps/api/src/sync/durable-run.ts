import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNull, lte, notExists, or, sql } from 'drizzle-orm'

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
import { isMetaAccessLoss, isMetaRateLimit, MetaApiError } from '../meta/client'

export type SyncSlice = 'account_data' | 'hierarchy' | 'insights' | 'creative' | 'historical_reconciliation'

export type DurableRunOptions = {
	agencyId: string
	trigger: 'cron' | 'connect' | 'manual'
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => import('../meta/client').MetaClient
	now?: Date
	clock?: () => Date
}

export type EnqueuedDurableRun = {
	runId: string
	invocationId: string
	joined: boolean
}

export type DurableGenerationResult = {
	runId: string
	status: 'queued' | 'running' | 'completed' | 'failed'
	processed: number
	failed: number
	skipped: number
	queued: number
}

export type DurableRunTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const runLeaseMilliseconds = 60 * 1000
const runMaximumActiveMilliseconds = 5 * 60 * 1000
const historyRetentionMilliseconds = 30 * 24 * 60 * 60 * 1000

export async function enqueueDurableRun({
	agencyId,
	trigger,
	slice,
	forceRefreshId,
	now = new Date(),
	enqueueOutcomes,
}: {
	agencyId: string
	trigger: 'cron' | 'connect' | 'manual'
	slice: SyncSlice
	forceRefreshId?: string
	now?: Date
	enqueueOutcomes: (transaction: DurableRunTransaction, runId: string, now: Date) => Promise<void>
}): Promise<EnqueuedDurableRun> {
	await pruneSyncHistory(now)

	return db.transaction(async transaction => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`)
		await transaction
			.update(syncRun)
			.set({ status: 'failed', leaseOwner: null, leaseExpiresAt: null, completedAt: now, updatedAt: now })
			.where(
				and(
					eq(syncRun.agencyId, agencyId),
					eq(syncRun.slice, slice),
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
					eq(syncRun.slice, slice),
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
				slice,
				trigger,
				status: 'queued',
				diagnosticReference: runDiagnosticReference(runId),
				forceRefreshId,
				createdAt: now,
				updatedAt: now,
			})
		}

		await enqueueOutcomes(transaction, runId, now)

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

export async function claimRun({
	agencyId,
	runId,
	slice,
	leaseOwner,
	now,
}: {
	agencyId: string
	runId: string
	slice: SyncSlice
	leaseOwner: string
	now: Date
}) {
	return db.transaction(async transaction => {
		const [run] = await transaction
			.update(syncRun)
			.set({
				status: 'running',
				leaseOwner,
				leaseExpiresAt: leaseExpiresAt(now),
				startedAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(syncRun.id, runId),
					eq(syncRun.agencyId, agencyId),
					eq(syncRun.slice, slice),
					or(
						eq(syncRun.status, 'queued'),
						and(
							eq(syncRun.status, 'running'),
							or(isNull(syncRun.leaseExpiresAt), lte(syncRun.leaseExpiresAt, now)),
						),
					),
				),
			)
			.returning({ id: syncRun.id })
		if (!run) return false

		await transaction
			.update(syncAccountOutcome)
			.set({ status: 'queued', leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
			.where(
				and(
					eq(syncAccountOutcome.runId, runId),
					eq(syncAccountOutcome.slice, slice),
					eq(syncAccountOutcome.status, 'running'),
					or(isNull(syncAccountOutcome.leaseExpiresAt), lte(syncAccountOutcome.leaseExpiresAt, now)),
				),
			)
		return true
	})
}

export async function claimOutcome({
	runId,
	outcomeId,
	slice,
	leaseOwner,
	now,
}: {
	runId: string
	outcomeId: string
	slice: SyncSlice
	leaseOwner: string
	now: Date
}) {
	const expiresAt = leaseExpiresAt(now)
	const [outcome] = await db
		.update(syncAccountOutcome)
		.set({
			status: 'running',
			leaseOwner,
			leaseExpiresAt: expiresAt,
			attemptedAt: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(syncAccountOutcome.id, outcomeId),
				eq(syncAccountOutcome.runId, runId),
				eq(syncAccountOutcome.slice, slice),
				eq(syncAccountOutcome.status, 'queued'),
			),
		)
		.returning({
			adAccountId: syncAccountOutcome.adAccountId,
			reconciliationDate: syncAccountOutcome.reconciliationDate,
		})
	return outcome ? { ...outcome, leaseExpiresAt: expiresAt } : undefined
}

export async function finishRun({
	runId,
	slice,
	leaseOwner,
	now,
}: {
	runId: string
	slice: SyncSlice
	leaseOwner: string
	now: Date
}) {
	await db.transaction(async transaction => {
		const [run] = await transaction
			.update(syncRun)
			.set({ updatedAt: now })
			.where(and(eq(syncRun.id, runId), eq(syncRun.slice, slice), eq(syncRun.leaseOwner, leaseOwner)))
			.returning({ id: syncRun.id })
		if (!run) return

		const outcomes = await transaction
			.select({ status: syncAccountOutcome.status })
			.from(syncAccountOutcome)
			.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, slice)))
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
				leaseExpiresAt: status === 'running' ? leaseExpiresAt(now) : null,
				completedAt: status === 'running' ? null : now,
				updatedAt: now,
			})
			.where(eq(syncRun.id, runId))
	})
}

export async function readGenerationResult(runId: string, slice: SyncSlice): Promise<DurableGenerationResult> {
	const [run] = await db.select().from(syncRun).where(eq(syncRun.id, runId)).limit(1)
	if (!run) throw new Error(`Sync run ${runId} not found`)
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, slice)))
	return {
		runId,
		status: run.status,
		processed: outcomes.filter(outcome => outcome.status === 'succeeded').length,
		failed: outcomes.filter(outcome => outcome.status === 'failed').length,
		skipped: outcomes.filter(outcome => outcome.status === 'skipped').length,
		queued: outcomes.filter(outcome => outcome.status === 'queued' || outcome.status === 'running').length,
	}
}

export async function loadAccountForRun(agencyId: string, accountId: string, metaMode: 'fake' | 'live') {
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

export async function mapWithConcurrency<T>(
	items: readonly T[],
	concurrency: number,
	task: (item: T) => Promise<boolean>,
) {
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

export function runDiagnosticReference(runId: string) {
	return `sync-run/${runId}`
}

export function outcomeDiagnosticReference(runId: string, slice: SyncSlice, accountId: string) {
	return `${runDiagnosticReference(runId)}/${slice.replaceAll('_', '-')}/${accountId}`
}

export function describePollError(error: unknown) {
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

export function errorCategory(error: unknown) {
	if (error instanceof MetaApiError) {
		if (isMetaAccessLoss(error)) return 'authorization'
		if (isMetaRateLimit(error)) return 'rate_limit'
		if (error.status >= 500) return 'upstream'
		return 'meta_validation'
	}
	return 'unexpected'
}

function leaseExpiresAt(now: Date) {
	return new Date(now.getTime() + runLeaseMilliseconds)
}
