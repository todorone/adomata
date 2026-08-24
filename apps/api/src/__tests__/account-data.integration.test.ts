import { and, asc, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { HttpResponse, http } from 'msw'

import { db, sql } from '../db'
import {
	adAccount,
	organization,
	organizationSettings,
	syncAccountOutcome,
	syncInvocation,
	syncRun,
} from '../db/schema'
import { MetaClient } from '../meta/client'
import { fakeMetaServer } from '../meta/fake/server'
import { fakeMetaAccounts, fakeMetaAgency, seedFakeMetaRoster } from '../meta/fake/roster'
import { replaceMetaAccessTokenAndRecoverAccounts } from '../sync/access-recovery'
import {
	enqueueAccountDataRun,
	pruneSyncHistory,
	runAccountDataGeneration,
	scheduleAccountDataRun,
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

	it('makes access-lost accounts due for operational work after replacing the Agency token', async () => {
		const now = new Date('2026-08-24T08:00:00.000Z')
		const accountId = 'act_100000000000001'
		await db
			.update(adAccount)
			.set({ connectionStatus: 'access_lost', accountDataNextDueAt: new Date(now.getTime() + 5 * 60 * 1000) })
			.where(eq(adAccount.id, accountId))
		await db.insert(organizationSettings).values({
			id: 'settings_1',
			organizationId: fakeMetaAgency.id,
			metaAccessToken: 'old-token',
			lastValidatedAt: new Date('2026-08-24T07:00:00.000Z'),
			updatedAt: new Date('2026-08-24T07:00:00.000Z'),
		})
		const run = await enqueueAccountDataRun(buildOptions(now))

		const replacement = await replaceMetaAccessTokenAndRecoverAccounts({
			agencyId: fakeMetaAgency.id,
			metaAccessToken: 'replacement-token',
			now,
		})

		expect(replacement.recoveredAccountIds).toEqual([accountId])
		const [settings] = await db
			.select({ metaAccessToken: organizationSettings.metaAccessToken })
			.from(organizationSettings)
			.where(eq(organizationSettings.organizationId, fakeMetaAgency.id))
		expect(settings).toEqual({ metaAccessToken: 'replacement-token' })
		const [account] = await db
			.select({ connectionStatus: adAccount.connectionStatus, nextDueAt: adAccount.accountDataNextDueAt })
			.from(adAccount)
			.where(eq(adAccount.id, accountId))
		expect(account).toEqual({ connectionStatus: 'pending', nextDueAt: now })

		const [outcome] = await db
			.select({ status: syncAccountOutcome.status })
			.from(syncAccountOutcome)
			.where(and(eq(syncAccountOutcome.runId, run.runId), eq(syncAccountOutcome.adAccountId, accountId)))
		expect(outcome).toEqual({ status: 'queued' })
	})

	it('classifies Meta code 190 as access lost with a diagnostic reference', async () => {
		const now = new Date('2026-08-24T08:00:00.000Z')
		const accountId = 'act_100000000000001'
		fakeMetaServer.use(
			http.get(`https://graph.facebook.com/v25.0/${accountId}`, () =>
				HttpResponse.json(
					{
						error: {
							message: 'Invalid OAuth access token',
							type: 'OAuthException',
							code: 190,
							fbtrace_id: 'expired-token',
						},
					},
					{ status: 400 },
				),
			),
		)

		const result = await scheduleAccountDataRun(buildOptions(now))
		const [account] = await db
			.select({
				connectionStatus: adAccount.connectionStatus,
				error: adAccount.accountDataError,
				diagnosticReference: adAccount.accountDataDiagnosticReference,
			})
			.from(adAccount)
			.where(eq(adAccount.id, accountId))

		expect(account).toEqual({
			connectionStatus: 'access_lost',
			error: 'Invalid OAuth access token code=190 fbtrace=expired-token',
			diagnosticReference: `sync-run/${result.runId}/account-data/${accountId}`,
		})
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
