import { randomUUID } from 'node:crypto'

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { db } from '../db'
import { forceRefresh, syncAccountOutcome, syncRun } from '../db/schema'
import type { MetaClient } from '../meta/client'
import { enqueueAccountDataRun, runAccountDataGeneration } from './account-data'
import { enqueueHierarchyRun, runHierarchyGeneration } from './hierarchy'
import { enqueueInsightsRun, runInsightsGeneration } from './insights'

const cooldownMilliseconds = 60 * 1000
const operationalSlices = ['account_data', 'hierarchy', 'insights'] as const

export type ForceRefreshStatus = 'queued' | 'running' | 'completed' | 'failed'

export type ForceRefreshResult = {
	id: string
	status: ForceRefreshStatus
}

export class ForceRefreshCooldownError extends Error {
	constructor() {
		super('Force Refresh is available once per minute')
	}
}

export async function requestForceRefresh({ agencyId, now = new Date() }: { agencyId: string; now?: Date }) {
	const forceRefreshId = await db.transaction(async transaction => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`)
		const [latest] = await transaction
			.select()
			.from(forceRefresh)
			.where(eq(forceRefresh.agencyId, agencyId))
			.orderBy(desc(forceRefresh.requestedAt))
			.limit(1)

		if (latest) {
			const status = await readForceRefreshStatus(transaction, latest.id)
			if (status === 'queued' || status === 'running') return latest.id
			if (latest.requestedAt.getTime() >= now.getTime() - cooldownMilliseconds) throw new ForceRefreshCooldownError()
		}

		const id = randomUUID()
		await transaction.insert(forceRefresh).values({ id, agencyId, requestedAt: now, createdAt: now })
		return id
	})

	await Promise.all([
		enqueueAccountDataRun({ agencyId, trigger: 'manual', force: true, forceRefreshId, now }),
		enqueueHierarchyRun({ agencyId, trigger: 'manual', force: true, forceRefreshId, now }),
		enqueueInsightsRun({ agencyId, trigger: 'manual', force: true, forceRefreshId, now }),
	])

	return { id: forceRefreshId, status: 'queued' as const }
}

export async function readForceRefresh({
	agencyId,
	forceRefreshId,
}: {
	agencyId: string
	forceRefreshId: string
}): Promise<ForceRefreshResult | null> {
	const [request] = await db
		.select({ id: forceRefresh.id })
		.from(forceRefresh)
		.where(and(eq(forceRefresh.id, forceRefreshId), eq(forceRefresh.agencyId, agencyId)))
		.limit(1)
	if (!request) return null

	return { id: request.id, status: await readForceRefreshStatus(db, request.id) }
}

export async function runForceRefresh({
	agencyId,
	forceRefreshId,
	metaMode,
	buildMetaClient,
}: {
	agencyId: string
	forceRefreshId: string
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
}) {
	const runs = await db
		.select({ id: syncRun.id, slice: syncRun.slice })
		.from(syncRun)
		.where(and(eq(syncRun.agencyId, agencyId), eq(syncRun.forceRefreshId, forceRefreshId)))

	await Promise.all(
		runs.map(run => {
			const options = { agencyId, runId: run.id, trigger: 'manual' as const, metaMode, buildMetaClient }
			switch (run.slice) {
				case 'account_data':
					return runAccountDataGeneration(options)
				case 'hierarchy':
					return runHierarchyGeneration(options)
				case 'insights':
					return runInsightsGeneration(options)
				default:
					return Promise.resolve()
			}
		}),
	)
}

export async function resumeForceRefreshes({
	metaMode,
	buildMetaClient,
}: {
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
}) {
	const requests = await db.select().from(forceRefresh)
	for (const request of requests) {
		if ((await readForceRefreshStatus(db, request.id)) === 'failed') continue
		const runs = await db
			.select({
				id: syncRun.id,
				slice: syncRun.slice,
				status: syncRun.status,
				startedAt: syncRun.startedAt,
				createdAt: syncRun.createdAt,
			})
			.from(syncRun)
			.where(and(eq(syncRun.forceRefreshId, request.id), inArray(syncRun.slice, operationalSlices)))
			.orderBy(desc(syncRun.createdAt))
		const latestBySlice = new Map<(typeof runs)[number]['slice'], (typeof runs)[number]>()
		for (const run of runs) {
			if (!latestBySlice.has(run.slice)) latestBySlice.set(run.slice, run)
		}
		const followUps = operationalSlices.filter(slice => {
			const run = latestBySlice.get(slice)
			return run?.status === 'completed' && run.startedAt !== null && run.startedAt < request.requestedAt
		})
		await Promise.all(
			followUps.map(slice => {
				const options = {
					agencyId: request.agencyId,
					trigger: 'manual' as const,
					force: true,
					forceRefreshId: request.id,
				}
				if (slice === 'account_data') return enqueueAccountDataRun(options)
				if (slice === 'hierarchy') return enqueueHierarchyRun(options)
				return enqueueInsightsRun(options)
			}),
		)
		const status = await readForceRefreshStatus(db, request.id)
		if (status === 'queued' || status === 'running')
			await runForceRefresh({ agencyId: request.agencyId, forceRefreshId: request.id, metaMode, buildMetaClient })
	}
}

async function readForceRefreshStatus(
	connection: Pick<typeof db, 'select'>,
	forceRefreshId: string,
): Promise<ForceRefreshStatus> {
	const [runs, failedOutcomes] = await Promise.all([
		connection
			.select({ status: syncRun.status })
			.from(syncRun)
			.where(and(eq(syncRun.forceRefreshId, forceRefreshId), inArray(syncRun.slice, operationalSlices)))
			.orderBy(asc(syncRun.createdAt)),
		connection
			.select({ id: syncAccountOutcome.id })
			.from(syncAccountOutcome)
			.innerJoin(syncRun, eq(syncAccountOutcome.runId, syncRun.id))
			.where(and(eq(syncRun.forceRefreshId, forceRefreshId), eq(syncAccountOutcome.status, 'failed'))),
	])
	return forceRefreshStatus(
		runs.map(run => run.status),
		failedOutcomes.length > 0,
	)
}

function forceRefreshStatus(
	statuses: Array<'queued' | 'running' | 'completed' | 'failed'>,
	hasFailedOutcome = false,
): ForceRefreshStatus {
	if (hasFailedOutcome || statuses.some(status => status === 'failed')) return 'failed'
	if (statuses.length < operationalSlices.length || statuses.some(status => status === 'queued')) return 'queued'
	if (statuses.some(status => status === 'running')) return 'running'
	return 'completed'
}
