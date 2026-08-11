import { asc, eq, inArray, sql as drizzleSql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { SQL } from 'bun'

import { db, sql } from '../db'
import { ad, adAccount, adCreative, adInsight, adSet, campaign, organization } from '../db/schema'
import { MetaClient } from '../meta/client'
import { fakeMetaServer } from '../meta/fake/server'
import { fakeMetaAccounts, fakeMetaAgency, seedFakeMetaRoster } from '../meta/fake/roster'
import { accountTierAdvisoryLock, insightsTierAdvisoryLock, runHeartbeat } from '../sync/account-tier'

const fakeAccessToken = 'integration-test-token'
function buildMetaClientWithAttemptCounter(attempts: { count: number }) {
	return (accessToken?: string) =>
		new MetaClient({
			accessToken: accessToken ?? fakeAccessToken,
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
		await expect(
			runHeartbeat({ metaMode: 'fake', buildMetaClient: buildMetaClientWithAttemptCounter(attempts), now }),
		).resolves.toEqual({
			accountTier: { processed: 5, failed: 2, skipped: 0, skippedNoToken: 0 },
			insightsTier: { processed: 5, failed: 0, skipped: 0, skippedNoToken: 0 },
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
		await runHeartbeat({
			metaMode: 'fake',
			buildMetaClient: buildMetaClientWithAttemptCounter(attempts),
			now: new Date(now.getTime() + 1000),
		})
		expect(attempts.count).toBeGreaterThan(firstAttemptCount)
	})

	it('backfills 90 local days and persists archived Ads with their tree', async () => {
		const now = new Date('2026-07-26T08:00:00.000Z')
		await db
			.update(adAccount)
			.set({ connectionStatus: 'pending', accountTierRefreshedAt: now, insightsTierRefreshedAt: now })
			.where(
				inArray(
					adAccount.id,
					fakeMetaAccounts.map(account => account.id),
				),
			)
		await db
			.update(adAccount)
			.set({ accountTierRefreshedAt: null, insightsTierRefreshedAt: null })
			.where(eq(adAccount.id, 'act_100000000000001'))

		await runHeartbeat({ metaMode: 'fake', buildMetaClient: buildMetaClientWithAttemptCounter({ count: 0 }), now })

		const archivedInsights = await db
			.select({ date: adInsight.date })
			.from(adInsight)
			.where(eq(adInsight.adId, 'ad-003'))
			.orderBy(asc(adInsight.date))
		expect(archivedInsights).toHaveLength(91)
		expect(archivedInsights[0]?.date).toBe('2026-04-27')
		expect(archivedInsights.at(-1)?.date).toBe('2026-07-26')

		const [archivedAd] = await db
			.select({
				adId: ad.id,
				adStatus: ad.effectiveStatus,
				adSetId: adSet.id,
				adSetStatus: adSet.effectiveStatus,
				campaignId: campaign.id,
				campaignStatus: campaign.effectiveStatus,
			})
			.from(ad)
			.innerJoin(adSet, eq(ad.adSetId, adSet.id))
			.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
			.where(eq(ad.id, 'ad-003'))
		expect(archivedAd).toEqual({
			adId: 'ad-003',
			adStatus: 'ARCHIVED',
			adSetId: 'adset-002',
			adSetStatus: 'ARCHIVED',
			campaignId: 'campaign-002',
			campaignStatus: 'ARCHIVED',
		})

		const [archivedCreative] = await db
			.select({ adId: adCreative.adId, creativeId: adCreative.id })
			.from(adCreative)
			.where(eq(adCreative.adId, 'ad-003'))
		expect(archivedCreative).toEqual({ adId: 'ad-003', creativeId: 'creative-003' })
	})

	it('stores jsonb as objects and arrays SQL can read into, not as encoded strings', async () => {
		const now = new Date('2026-07-26T08:00:00.000Z')
		await db
			.update(adAccount)
			.set({ connectionStatus: 'pending', accountTierRefreshedAt: null, insightsTierRefreshedAt: null })
			.where(
				inArray(
					adAccount.id,
					fakeMetaAccounts.map(account => account.id),
				),
			)

		await runHeartbeat({ metaMode: 'fake', buildMetaClient: buildMetaClientWithAttemptCounter({ count: 0 }), now })

		const [shapes] = await sql`
			select
				(select count(*) from ad_creative where jsonb_typeof(payload) <> 'object') as bad_payloads,
				(select count(*) from ad_insight where jsonb_typeof(actions) <> 'array') as bad_actions,
				(select count(*) from ad_insight where jsonb_typeof(action_values) <> 'array') as bad_action_values,
				(select count(*) from ad_creative where payload ? 'asset_feed_spec') as payloads_sql_can_query
		`
		expect(Number(shapes.bad_payloads)).toBe(0)
		expect(Number(shapes.bad_actions)).toBe(0)
		expect(Number(shapes.bad_action_values)).toBe(0)
		expect(Number(shapes.payloads_sql_can_query)).toBeGreaterThan(0)
	})

	it('skips due accounts in live mode when the Agency has no organizationSettings token', async () => {
		const now = new Date('2026-07-29T08:00:00.000Z')
		await db
			.update(adAccount)
			.set({ connectionStatus: 'pending', accountTierRefreshedAt: null, lastPollError: null })
			.where(drizzleSql`${adAccount.id} in ${fakeMetaAccounts.map(account => account.id)}`)

		const buildMetaClient = (): MetaClient => {
			throw new Error('buildMetaClient should not be called when no Agency token is configured')
		}

		await expect(runHeartbeat({ metaMode: 'live', buildMetaClient, now })).resolves.toEqual({
			accountTier: { processed: 0, failed: 0, skipped: 0, skippedNoToken: fakeMetaAccounts.length },
			insightsTier: { processed: 0, failed: 0, skipped: 0, skippedNoToken: 0 },
		})

		const accounts = await readFixtureAccounts()
		for (const account of accounts) {
			expect(account.connectionStatus).toBe('pending')
			expect(account.lastPollError).toBe('No Meta token configured for this Agency')
			expect(account.accountTierRefreshedAt).toBeNull()
		}
	})

	it('does nothing when another Account Tier sync holds the advisory lock', async () => {
		const attempts = { count: 0 }
		const competingSql = new SQL({ url: process.env.DATABASE_URL })
		await competingSql`select pg_advisory_lock(${accountTierAdvisoryLock})`
		await competingSql`select pg_advisory_lock(${insightsTierAdvisoryLock})`
		try {
			await expect(
				runHeartbeat({ metaMode: 'fake', buildMetaClient: buildMetaClientWithAttemptCounter(attempts) }),
			).resolves.toEqual({
				accountTier: { processed: 0, failed: 0, skipped: 1, skippedNoToken: 0 },
				insightsTier: { processed: 0, failed: 0, skipped: 1, skippedNoToken: 0 },
			})
			expect(attempts.count).toBe(0)
		} finally {
			await competingSql`select pg_advisory_unlock(${accountTierAdvisoryLock})`
			await competingSql`select pg_advisory_unlock(${insightsTierAdvisoryLock})`
			await competingSql.end()
		}
	})
})
