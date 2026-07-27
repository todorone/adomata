import { eq, sql as drizzleSql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { SQL } from 'bun'

import { db, sql } from '../db'
import { adAccount, organization } from '../db/schema'
import { MetaClient } from '../meta/client'
import { fakeMetaServer } from '../meta/fake/server'
import { fakeMetaAccounts, fakeMetaAgency, seedFakeMetaRoster } from '../meta/fake/roster'
import { accountTierAdvisoryLock, insightsTierAdvisoryLock, runHeartbeat } from '../sync/account-tier'

const fakeAccessToken = 'integration-test-token'
function clientWithAttemptCounter(attempts: { count: number }) {
	return new MetaClient({
		accessToken: fakeAccessToken,
		fetch: async url => {
			attempts.count += 1
			return fetch(url)
		},
		sleep: async () => undefined,
	})
}

async function readFixtureAccounts() {
	return db
		.select()
		.from(adAccount)
		.where(drizzleSql`${adAccount.id} in ${fakeMetaAccounts.map(account => account.id)}`)
}

describe('Account Tier heartbeat integration', () => {
	beforeAll(async () => {
		fakeMetaServer.listen({ onUnhandledRequest: 'error' })
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
	})

	beforeEach(async () => {
		fakeMetaServer.resetHandlers()
		await db
			.insert(organization)
			.values({ ...fakeMetaAgency, createdAt: new Date(), updatedAt: new Date() })
			.onConflictDoNothing()
		await seedFakeMetaRoster(fakeMetaAgency.id)
	})

	afterAll(async () => {
		fakeMetaServer.close()
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
		await sql.end()
	})

	it('uses shared roster IDs and safely upserts the seed', async () => {
		await seedFakeMetaRoster(fakeMetaAgency.id)
		const seeded = await readFixtureAccounts()
		expect(seeded.map(account => account.id).sort()).toEqual(fakeMetaAccounts.map(account => account.id).sort())
		expect(seeded).toHaveLength(7)
	})

	it('persists exact successful raw signals, retries throttle, and records access loss', async () => {
		const attempts = { count: 0 }
		const now = new Date('2026-07-26T08:00:00.000Z')
		await expect(runHeartbeat({ metaClient: clientWithAttemptCounter(attempts), now })).resolves.toEqual({
			accountTier: { processed: 5, failed: 2, skipped: 0 },
			insightsTier: { processed: 5, failed: 0, skipped: 0 },
		})
		expect(attempts.count).toBeGreaterThan(8)

		const accounts = await readFixtureAccounts()
		for (const fixture of fakeMetaAccounts.filter(account => account.kind === 'success')) {
			const persisted = accounts.find(account => account.id === fixture.id)
			expect(persisted).toMatchObject({
				connectionStatus: 'connected',
				metaAccountStatus: fixture.accountStatus,
				metaDisableReason: fixture.disableReason,
				balance: fixture.balance,
				isPrepayAccount: fixture.isPrepayAccount,
				fundingSourceType: fixture.fundingSourceType,
				lastPollError: null,
			})
			expect(persisted?.accountTierRefreshedAt).toEqual(now)
			expect(persisted?.insightsTierRefreshedAt).toEqual(now)
			expect(persisted?.timezoneName).toBe(fixture.timezoneName)
			expect(persisted?.healthColor).toBeNull()
		}

		const throttled = accounts.find(account => account.id === 'act_100000000000005')
		expect(throttled).toMatchObject({ connectionStatus: 'pending', accountTierRefreshedAt: null })
		expect(throttled?.lastPollError).toContain('code=4')
		const revoked = accounts.find(account => account.id === 'act_100000000000006')
		expect(revoked).toMatchObject({ connectionStatus: 'access_lost', accountTierRefreshedAt: null })
		expect(revoked?.lastPollError).toContain('code=10')

		const firstAttemptCount = attempts.count
		await runHeartbeat({ metaClient: clientWithAttemptCounter(attempts), now: new Date(now.getTime() + 1000) })
		expect(attempts.count).toBeGreaterThan(firstAttemptCount)
	})

	it('does nothing when another Account Tier sync holds the advisory lock', async () => {
		const attempts = { count: 0 }
		const competingSql = new SQL({ url: process.env.DATABASE_URL })
		await competingSql`select pg_advisory_lock(${accountTierAdvisoryLock})`
		await competingSql`select pg_advisory_lock(${insightsTierAdvisoryLock})`
		try {
			await expect(runHeartbeat({ metaClient: clientWithAttemptCounter(attempts) })).resolves.toEqual({
				accountTier: { processed: 0, failed: 0, skipped: 1 },
				insightsTier: { processed: 0, failed: 0, skipped: 1 },
			})
			expect(attempts.count).toBe(0)
		} finally {
			await competingSql`select pg_advisory_unlock(${accountTierAdvisoryLock})`
			await competingSql`select pg_advisory_unlock(${insightsTierAdvisoryLock})`
			await competingSql.end()
		}
	})
})
