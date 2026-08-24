import { asc, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { db, sql } from '../db'
import { adAccount, organization, syncAccountOutcome, syncInvocation, syncRun } from '../db/schema'
import { MetaClient } from '../meta/client'
import { fakeMetaServer } from '../meta/fake/server'
import { fakeMetaAccounts, fakeMetaAgency, seedFakeMetaRoster } from '../meta/fake/roster'
import {
	enqueueAccountDataRun,
	pruneSyncHistory,
	runAccountDataGeneration,
	type AccountDataRunOptions,
} from '../sync/account-data'

function buildOptions(now: Date): AccountDataRunOptions {
	return {
		agencyId: fakeMetaAgency.id,
		trigger: 'cron',
		metaMode: 'fake',
		buildMetaClient: () => new MetaClient({ accessToken: 'integration-test-token', sleep: async () => undefined }),
		now,
		clock: () => now,
	}
}

describe('durable Account data work', () => {
	beforeAll(async () => {
		fakeMetaServer.listen({ onUnhandledRequest: 'error' })
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
	})

	beforeEach(async () => {
		fakeMetaServer.resetHandlers()
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
		await db
			.insert(organization)
			.values({ ...fakeMetaAgency, createdAt: new Date(), updatedAt: new Date() })
			.onConflictDoNothing()
		await seedFakeMetaRoster(fakeMetaAgency.id)
		await db.delete(syncRun).where(eq(syncRun.agencyId, fakeMetaAgency.id))
	})

	afterAll(async () => {
		fakeMetaServer.close()
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
		await sql.end()
	})

	it('coalesces receipts and commits each account independently', async () => {
		const now = new Date('2026-08-24T08:00:00.000Z')
		const options = buildOptions(now)
		const first = await enqueueAccountDataRun(options)
		const second = await enqueueAccountDataRun(options)

		expect(second.runId).toBe(first.runId)
		const receipts = await db
			.select({ runId: syncInvocation.runId })
			.from(syncInvocation)
			.where(eq(syncInvocation.agencyId, fakeMetaAgency.id))
		expect(receipts).toHaveLength(2)
		expect(new Set(receipts.map(receipt => receipt.runId))).toEqual(new Set([first.runId]))

		const result = await runAccountDataGeneration({ ...options, runId: first.runId })
		expect(result.status).toBe('failed')
		expect(result.processed).toBe(5)
		expect(result.failed).toBe(2)

		const outcomes = await db
			.select({ accountId: syncAccountOutcome.adAccountId, status: syncAccountOutcome.status })
			.from(syncAccountOutcome)
			.where(eq(syncAccountOutcome.runId, first.runId))
			.orderBy(asc(syncAccountOutcome.adAccountId))
		expect(outcomes).toHaveLength(fakeMetaAccounts.length)
		expect(outcomes.filter(outcome => outcome.status === 'succeeded')).toHaveLength(5)
		expect(outcomes.filter(outcome => outcome.status === 'failed')).toHaveLength(2)

		const accounts = await db
			.select({ id: adAccount.id, successfulAt: adAccount.accountDataSuccessfulAt })
			.from(adAccount)
			.where(
				inArray(
					adAccount.id,
					fakeMetaAccounts.map(account => account.id),
				),
			)
		for (const account of accounts.filter(
			account => account.id !== 'act_100000000000005' && account.id !== 'act_100000000000006',
		)) {
			expect(account.successfulAt).toEqual(now)
		}
		expect(accounts.find(account => account.id === 'act_100000000000005')?.successfulAt).toBeNull()
		expect(accounts.find(account => account.id === 'act_100000000000006')?.successfulAt).toBeNull()
	})

	it('reclaims an expired generation lease after an API restart', async () => {
		const now = new Date('2026-08-24T08:00:00.000Z')
		const queued = await enqueueAccountDataRun(buildOptions(now))
		const expired = new Date(now.getTime() - 1_000)
		await db
			.update(syncRun)
			.set({ status: 'running', leaseOwner: 'dead-api', leaseExpiresAt: expired })
			.where(eq(syncRun.id, queued.runId))

		const result = await runAccountDataGeneration({ ...buildOptions(now), runId: queued.runId })
		expect(result.status).toBe('failed')
		expect(result.processed).toBe(5)
	})

	it('expires detailed history without removing the current Account data state', async () => {
		const now = new Date('2026-08-24T08:00:00.000Z')
		const options = buildOptions(now)
		const queued = await enqueueAccountDataRun(options)
		await runAccountDataGeneration({ ...options, runId: queued.runId })
		await db
			.update(syncRun)
			.set({ status: 'running', createdAt: new Date('2026-07-24T08:00:00.000Z') })
			.where(eq(syncRun.id, queued.runId))

		await pruneSyncHistory(now)

		expect(await db.select().from(syncRun).where(eq(syncRun.id, queued.runId))).toHaveLength(0)
		const [account] = await db
			.select({ successfulAt: adAccount.accountDataSuccessfulAt })
			.from(adAccount)
			.where(eq(adAccount.id, 'act_100000000000001'))
		expect(account?.successfulAt).toEqual(now)
	})
})
