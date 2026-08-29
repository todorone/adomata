import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { db, sql } from '../db'
import { adAccount, organization, syncAccountOutcome, syncRun } from '../db/schema'
import { MetaClient } from '../meta/client'
import { fakeMetaServer } from '../meta/fake/server'
import { fakeMetaAccounts, fakeMetaAgency, seedFakeMetaRoster } from '../meta/fake/roster'
import {
	ForceRefreshCooldownError,
	readForceRefresh,
	requestForceRefresh,
	resumeForceRefreshes,
	runForceRefresh,
} from '../sync/force-refresh'

describe('Force Refresh', () => {
	beforeAll(async () => {
		fakeMetaServer.listen({ onUnhandledRequest: 'error' })
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
	})

	beforeEach(async () => {
		fakeMetaServer.resetHandlers()
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
		await db.insert(organization).values({ ...fakeMetaAgency, createdAt: new Date(), updatedAt: new Date() })
		await seedFakeMetaRoster(fakeMetaAgency.id)
	})

	afterAll(async () => {
		fakeMetaServer.close()
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
		await sql.end()
	})

	it('creates one persisted Operational Slice generation, coalesces concurrent clicks, and reports it for polling', async () => {
		const clickedAt = new Date('2026-08-24T08:00:00.000Z')
		const unavailableAccountIds = fakeMetaAccounts
			.filter(account => account.kind !== 'success')
			.map(account => account.id)
		await db
			.update(adAccount)
			.set({ connectionStatus: 'access_lost' })
			.where(inArray(adAccount.id, unavailableAccountIds))
		const [first, concurrent] = await Promise.all([
			requestForceRefresh({ agencyId: fakeMetaAgency.id, now: clickedAt }),
			requestForceRefresh({ agencyId: fakeMetaAgency.id, now: clickedAt }),
		])

		expect(concurrent).toEqual(first)
		expect(await readForceRefresh({ agencyId: fakeMetaAgency.id, forceRefreshId: first.id })).toEqual({
			id: first.id,
			status: 'queued',
		})

		const runs = await db
			.select({ id: syncRun.id, slice: syncRun.slice, trigger: syncRun.trigger })
			.from(syncRun)
			.where(eq(syncRun.agencyId, fakeMetaAgency.id))
		expect(runs).toHaveLength(3)
		expect(runs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ slice: 'account_data', trigger: 'manual' }),
				expect.objectContaining({ slice: 'hierarchy', trigger: 'manual' }),
				expect.objectContaining({ slice: 'insights', trigger: 'manual' }),
			]),
		)

		await runForceRefresh({
			agencyId: fakeMetaAgency.id,
			forceRefreshId: first.id,
			metaMode: 'fake',
			buildMetaClient: () => new MetaClient({ accessToken: 'integration-test-token', sleep: async () => undefined }),
		})
		expect(await readForceRefresh({ agencyId: fakeMetaAgency.id, forceRefreshId: first.id })).toEqual({
			id: first.id,
			status: 'completed',
		})
	})

	it('enforces the one-minute cooldown after a completed generation and schedules one follow-up after it expires', async () => {
		const firstClick = new Date('2026-08-24T09:00:00.000Z')
		const first = await requestForceRefresh({ agencyId: fakeMetaAgency.id, now: firstClick })
		await db
			.update(syncRun)
			.set({ status: 'completed', completedAt: firstClick, updatedAt: firstClick })
			.where(eq(syncRun.forceRefreshId, first.id))

		await expect(
			requestForceRefresh({ agencyId: fakeMetaAgency.id, now: new Date('2026-08-24T09:00:30.000Z') }),
		).rejects.toBeInstanceOf(ForceRefreshCooldownError)

		const followUp = await requestForceRefresh({
			agencyId: fakeMetaAgency.id,
			now: new Date('2026-08-24T09:01:01.000Z'),
		})
		expect(followUp.id).not.toBe(first.id)

		const runs = await db.select({ id: syncRun.id }).from(syncRun).where(eq(syncRun.agencyId, fakeMetaAgency.id))
		expect(runs).toHaveLength(6)
	})

	it('reports a failed slice outcome before the remaining generation finishes', async () => {
		const refresh = await requestForceRefresh({
			agencyId: fakeMetaAgency.id,
			now: new Date('2026-08-24T10:00:00.000Z'),
		})
		const [outcome] = await db
			.select({ id: syncAccountOutcome.id })
			.from(syncAccountOutcome)
			.innerJoin(syncRun, eq(syncAccountOutcome.runId, syncRun.id))
			.where(eq(syncRun.forceRefreshId, refresh.id))
			.limit(1)
		expect(outcome).toBeDefined()
		await db.update(syncAccountOutcome).set({ status: 'failed' }).where(eq(syncAccountOutcome.id, outcome!.id))

		expect(await readForceRefresh({ agencyId: fakeMetaAgency.id, forceRefreshId: refresh.id })).toEqual({
			id: refresh.id,
			status: 'failed',
		})
	})

	it('adds accounts outside their due window when Force Refresh joins active slices', async () => {
		const now = new Date('2026-08-24T10:30:00.000Z')
		const accountId = 'act_100000000000001'
		await db
			.update(adAccount)
			.set({
				connectionStatus: 'connected',
				accountDataNextDueAt: new Date(now.getTime() + 5 * 60 * 1_000),
				hierarchyNextDueAt: new Date(now.getTime() + 5 * 60 * 1_000),
				insightsNextDueAt: new Date(now.getTime() + 5 * 60 * 1_000),
			})
			.where(eq(adAccount.id, accountId))
		await db.insert(syncRun).values(
			(['account_data', 'hierarchy', 'insights'] as const).map(slice => ({
				id: `active-${slice}`,
				agencyId: fakeMetaAgency.id,
				slice,
				trigger: 'cron' as const,
				status: 'running' as const,
				leaseOwner: `runner-${slice}`,
				leaseExpiresAt: new Date(now.getTime() + 60_000),
				createdAt: now,
				updatedAt: now,
			})),
		)

		await requestForceRefresh({ agencyId: fakeMetaAgency.id, now })

		const outcomes = await db
			.select({ slice: syncAccountOutcome.slice })
			.from(syncAccountOutcome)
			.innerJoin(syncRun, eq(syncAccountOutcome.runId, syncRun.id))
			.where(and(eq(syncRun.agencyId, fakeMetaAgency.id), eq(syncAccountOutcome.adAccountId, accountId)))
		expect(outcomes).toEqual(
			expect.arrayContaining([{ slice: 'account_data' }, { slice: 'hierarchy' }, { slice: 'insights' }]),
		)
	})

	it('schedules one post-click follow-up after joining a generation that started before the click', async () => {
		const startedAt = new Date('2026-08-24T10:59:00.000Z')
		const clickedAt = new Date('2026-08-24T11:00:00.000Z')
		await db.insert(syncRun).values({
			id: 'pre-click-account-data',
			agencyId: fakeMetaAgency.id,
			slice: 'account_data',
			trigger: 'cron',
			status: 'running',
			startedAt,
			leaseOwner: 'existing-runner',
			leaseExpiresAt: new Date('2026-08-24T11:10:00.000Z'),
			createdAt: startedAt,
			updatedAt: startedAt,
		})
		const refresh = await requestForceRefresh({ agencyId: fakeMetaAgency.id, now: clickedAt })
		await db
			.update(syncRun)
			.set({ status: 'completed', completedAt: clickedAt, updatedAt: clickedAt })
			.where(eq(syncRun.id, 'pre-click-account-data'))

		await resumeForceRefreshes({
			metaMode: 'fake',
			buildMetaClient: () => new MetaClient({ accessToken: 'integration-test-token', sleep: async () => undefined }),
		})
		const accountDataRuns = await db
			.select({ id: syncRun.id, slice: syncRun.slice, startedAt: syncRun.startedAt })
			.from(syncRun)
			.where(eq(syncRun.forceRefreshId, refresh.id))
			.orderBy(syncRun.createdAt)
		const accountDataFollowUps = accountDataRuns.filter(
			run => run.slice === 'account_data' && run.id !== 'pre-click-account-data',
		)
		expect(accountDataFollowUps).toHaveLength(1)
		const followUp = accountDataFollowUps[0]
		expect(followUp?.startedAt?.getTime()).toBeGreaterThanOrEqual(clickedAt.getTime())
	})
})
