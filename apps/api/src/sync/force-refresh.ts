import { randomUUID } from 'node:crypto'

import { and, asc, desc, eq, gte, inArray, notExists, or, sql } from 'drizzle-orm'

import { db } from '../db'
import { forceRefresh, syncAccountOutcome, syncRun } from '../db/schema'
import type { MetaClient } from '../meta/client'
import { enqueueAccountDataRun, runAccountDataGeneration } from './account-data'
import { enqueueHierarchyRun, runHierarchyGeneration } from './hierarchy'
import { enqueueInsightsRun, runInsightsGeneration } from './insights'

const cooldownMilliseconds = 60 * 1000
const forceRefreshLifetimeMilliseconds = 5 * 60 * 1000
const maxForceRefreshesPerResume = 10
const operationalSlices = ['account_data', 'hierarchy', 'insights'] as const

type OperationalSlice = (typeof operationalSlices)[number]
type ForceRefreshRun = {
	id: string
	slice: OperationalSlice
	status: ForceRefreshStatus
	startedAt: Date | null
	createdAt: Date
}
type ForceRefreshState = {
	latestBySlice: Map<OperationalSlice, ForceRefreshRun>
	hasFailedOutcome: boolean
}

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
			const status = await readForceRefreshStatus(transaction, latest.id, latest.requestedAt, now)
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
	now = new Date(),
}: {
	agencyId: string
	forceRefreshId: string
	now?: Date
}): Promise<ForceRefreshResult | null> {
	const [request] = await db
		.select({ id: forceRefresh.id, requestedAt: forceRefresh.requestedAt })
		.from(forceRefresh)
		.where(and(eq(forceRefresh.id, forceRefreshId), eq(forceRefresh.agencyId, agencyId)))
		.limit(1)
	if (!request) return null

	return { id: request.id, status: await readForceRefreshStatus(db, request.id, request.requestedAt, now) }
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
	now = new Date(),
}: {
	metaMode: 'fake' | 'live'
	buildMetaClient: (accessToken?: string) => MetaClient
	now?: Date
}) {
	const activeAfter = new Date(now.getTime() - forceRefreshLifetimeMilliseconds)
	const requests = await db
		.select({ id: forceRefresh.id, agencyId: forceRefresh.agencyId, requestedAt: forceRefresh.requestedAt })
		.from(forceRefresh)
		.where(
			and(
				gte(forceRefresh.requestedAt, activeAfter),
				notExists(
					db
						.select({ id: syncRun.id })
						.from(syncRun)
						.where(and(eq(syncRun.forceRefreshId, forceRefresh.id), eq(syncRun.status, 'failed'))),
				),
				notExists(
					db
						.select({ id: syncAccountOutcome.id })
						.from(syncAccountOutcome)
						.innerJoin(syncRun, eq(syncAccountOutcome.runId, syncRun.id))
						.where(and(eq(syncRun.forceRefreshId, forceRefresh.id), eq(syncAccountOutcome.status, 'failed'))),
				),
				or(
					...operationalSlices.map(slice =>
						notExists(
							db
								.select({ id: syncRun.id })
								.from(syncRun)
								.where(
									and(
										eq(syncRun.forceRefreshId, forceRefresh.id),
										eq(syncRun.slice, slice),
										eq(syncRun.status, 'completed'),
										gte(syncRun.startedAt, forceRefresh.requestedAt),
									),
								),
						),
					),
				),
			),
		)
		.orderBy(asc(forceRefresh.requestedAt))
		.limit(maxForceRefreshesPerResume)
	const states = await readForceRefreshStates(
		db,
		requests.map(request => request.id),
	)
	for (const request of requests) {
		const state = states.get(request.id)!
		const status = forceRefreshStatus(state, request.requestedAt, now)
		if (status === 'completed' || status === 'failed') continue
		const followUps = operationalSlices.filter(slice => {
			const run = state.latestBySlice.get(slice)
			return run?.status === 'completed' && run.startedAt !== null && run.startedAt < request.requestedAt
		})
		await Promise.all(
			followUps.map(slice => {
				const options = {
					agencyId: request.agencyId,
					trigger: 'manual' as const,
					force: true,
					forceRefreshId: request.id,
					now,
				}
				if (slice === 'account_data') return enqueueAccountDataRun(options)
				if (slice === 'hierarchy') return enqueueHierarchyRun(options)
				return enqueueInsightsRun(options)
			}),
		)
		await runForceRefresh({ agencyId: request.agencyId, forceRefreshId: request.id, metaMode, buildMetaClient })
	}
}

async function readForceRefreshStatus(
	connection: Pick<typeof db, 'select'>,
	forceRefreshId: string,
	requestedAt: Date,
	now: Date,
): Promise<ForceRefreshStatus> {
	const states = await readForceRefreshStates(connection, [forceRefreshId])
	return forceRefreshStatus(states.get(forceRefreshId)!, requestedAt, now)
}

async function readForceRefreshStates(connection: Pick<typeof db, 'select'>, forceRefreshIds: string[]) {
	const states = new Map<string, ForceRefreshState>(
		forceRefreshIds.map(id => [id, { latestBySlice: new Map(), hasFailedOutcome: false }]),
	)
	if (forceRefreshIds.length === 0) return states

	const runs = await connection
		.select({
			forceRefreshId: syncRun.forceRefreshId,
			id: syncRun.id,
			slice: syncRun.slice,
			status: syncRun.status,
			startedAt: syncRun.startedAt,
			createdAt: syncRun.createdAt,
			outcomeStatus: syncAccountOutcome.status,
		})
		.from(syncRun)
		.leftJoin(syncAccountOutcome, eq(syncAccountOutcome.runId, syncRun.id))
		.where(and(inArray(syncRun.forceRefreshId, forceRefreshIds), inArray(syncRun.slice, operationalSlices)))
		.orderBy(desc(syncRun.createdAt))

	for (const run of runs) {
		if (!run.forceRefreshId) continue
		const state = states.get(run.forceRefreshId)
		if (!state) continue
		if (run.outcomeStatus === 'failed') state.hasFailedOutcome = true
		const slice = run.slice as OperationalSlice
		if (!state.latestBySlice.has(slice)) state.latestBySlice.set(slice, run as ForceRefreshRun)
	}
	return states
}

function forceRefreshStatus(state: ForceRefreshState, requestedAt: Date, now: Date): ForceRefreshStatus {
	const latestRuns = operationalSlices.map(slice => state.latestBySlice.get(slice))
	if (state.hasFailedOutcome || latestRuns.some(run => run?.status === 'failed')) return 'failed'
	if (
		latestRuns.some(
			run => run === undefined || run.status === 'queued' || run.startedAt === null || run.startedAt < requestedAt,
		)
	)
		return now.getTime() - requestedAt.getTime() >= forceRefreshLifetimeMilliseconds ? 'failed' : 'queued'
	if (latestRuns.some(run => run?.status === 'running'))
		return now.getTime() - requestedAt.getTime() >= forceRefreshLifetimeMilliseconds ? 'failed' : 'running'
	return 'completed'
}
