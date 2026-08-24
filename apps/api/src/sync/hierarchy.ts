import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import { logger } from '../core/logger'
import { db } from '../db'
import {
	ad,
	adAccount,
	adSet,
	campaign,
	client,
	organizationSettings,
	syncAccountOutcome,
	syncInvocation,
	syncRun,
} from '../db/schema'
import { isMetaAccessLoss, MetaApiError } from '../meta/client'
import type { MetaClient } from '../meta/client'
import { pruneSyncHistory } from './account-data'

const hierarchyIntervalMilliseconds = 5 * 60 * 1000
const runLeaseMilliseconds = 60 * 1000
const hierarchyConcurrency = 3
const noTokenMessage = 'No Meta token configured for this Agency'

export type HierarchyRunOptions = {
	agencyId: string
	trigger: 'cron' | 'connect' | 'manual'
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now?: Date
	clock?: () => Date
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
}

export async function enqueueHierarchyRun({
	agencyId,
	trigger,
	now = new Date(),
}: Pick<HierarchyRunOptions, 'agencyId' | 'trigger' | 'now'>): Promise<EnqueuedHierarchyRun> {
	await pruneSyncHistory(now)

	return db.transaction(async transaction => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`)

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

		const runId = activeRun?.id ?? randomUUID()
		const joined = Boolean(activeRun)
		if (!activeRun) {
			await transaction.insert(syncRun).values({
				id: runId,
				agencyId,
				slice: 'hierarchy',
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
						or(isNull(adAccount.hierarchySuccessfulAt), lte(adAccount.hierarchyNextDueAt, now)),
					),
				)

			if (dueAccounts.length > 0) {
				await transaction.insert(syncAccountOutcome).values(
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
	const results: HierarchyGenerationResult[] = []
	for (const agency of agencies) {
		const result = await scheduleHierarchyRun({ ...options, agencyId: agency.id })
		results.push(result)
	}
	return results
}

export async function runHierarchyGeneration({
	agencyId,
	runId,
	metaMode,
	buildMetaClient,
	now = new Date(),
	clock = () => new Date(),
}: HierarchyRunOptions & { runId: string }): Promise<HierarchyGenerationResult> {
	const leaseOwner = randomUUID()
	const leaseExpiresAt = new Date(now.getTime() + runLeaseMilliseconds)
	const claimed = await claimRun({ agencyId, runId, leaseOwner, now, leaseExpiresAt })
	if (!claimed) return await readGenerationResult(runId)

	const outcomes = await db
		.select({ id: syncAccountOutcome.id })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'hierarchy')))
		.orderBy(asc(syncAccountOutcome.createdAt))
	await mapWithConcurrency(outcomes, hierarchyConcurrency, async outcome => {
		await processOutcome({
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

	await finishRun({ runId, leaseOwner, now })
	const result = await readGenerationResult(runId)
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
					eq(syncRun.slice, 'hierarchy'),
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
					eq(syncAccountOutcome.slice, 'hierarchy'),
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

async function processOutcome(params: HierarchyOutcomeContext) {
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
				eq(syncAccountOutcome.slice, 'hierarchy'),
				eq(syncAccountOutcome.status, 'queued'),
			),
		)
		.returning({ adAccountId: syncAccountOutcome.adAccountId })
	if (!claimed[0]) return true

	await db
		.update(adAccount)
		.set({
			hierarchyAttemptedAt: params.now,
			hierarchyLeaseOwner: params.leaseOwner,
			hierarchyLeaseExpiresAt: leaseExpiresAt,
			updatedAt: params.now,
		})
		.where(eq(adAccount.id, claimed[0].adAccountId))

	const account = await loadAccountForRun(params.agencyId, claimed[0].adAccountId, params.metaMode)
	if (!account) {
		await recordOutcomeFailure(
			params,
			new Error('Ad Account disappeared before hierarchy work started'),
			claimed[0].adAccountId,
		)
		return false
	}

	try {
		if (params.metaMode === 'live' && !account.metaAccessToken) {
			await recordOutcomeSkipped(params, account.adAccount.id)
			return false
		}

		const metaClient = params.buildMetaClient(account.metaAccessToken ?? undefined)
		const [campaigns, adSets, ads] = await Promise.all([
			metaClient.listCampaigns(account.adAccount.id),
			metaClient.listAdSets(account.adAccount.id),
			metaClient.listAds(account.adAccount.id),
		])

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
					hierarchyNextDueAt: new Date(committedAt.getTime() + hierarchyIntervalMilliseconds),
					hierarchyLeaseOwner: null,
					hierarchyLeaseExpiresAt: null,
					updatedAt: committedAt,
				})
				.where(eq(adAccount.id, account.adAccount.id))
		})
		return true
	} catch (error) {
		await recordOutcomeFailure(params, error, account.adAccount.id)
		return false
	}
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
				hierarchyNextDueAt: new Date(occurredAt.getTime() + hierarchyIntervalMilliseconds),
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

async function finishRun({ runId, leaseOwner, now }: { runId: string; leaseOwner: string; now: Date }) {
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'hierarchy')))
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
		.where(and(eq(syncRun.id, runId), eq(syncRun.slice, 'hierarchy'), eq(syncRun.leaseOwner, leaseOwner)))
}

async function readGenerationResult(runId: string): Promise<HierarchyGenerationResult> {
	const [run] = await db.select().from(syncRun).where(eq(syncRun.id, runId)).limit(1)
	if (!run) throw new Error(`Sync run ${runId} not found`)
	const outcomes = await db
		.select({ status: syncAccountOutcome.status })
		.from(syncAccountOutcome)
		.where(and(eq(syncAccountOutcome.runId, runId), eq(syncAccountOutcome.slice, 'hierarchy')))
	return {
		runId,
		status: run.status,
		processed: outcomes.filter(outcome => outcome.status === 'succeeded').length,
		failed: outcomes.filter(outcome => outcome.status === 'failed').length,
		skipped: outcomes.filter(outcome => outcome.status === 'skipped').length,
		queued: outcomes.filter(outcome => outcome.status === 'queued' || outcome.status === 'running').length,
	}
}

async function mapWithConcurrency<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>) {
	let nextIndex = 0
	async function worker() {
		while (nextIndex < items.length) {
			const item = items[nextIndex]
			nextIndex += 1
			await task(item)
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

function runDiagnosticReference(runId: string) {
	return `sync-run/${runId}`
}

function hierarchyDiagnosticReference(runId: string, accountId: string) {
	return `${runDiagnosticReference(runId)}/hierarchy/${accountId}`
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
