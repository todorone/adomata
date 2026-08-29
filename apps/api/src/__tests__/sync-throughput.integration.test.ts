import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { HttpResponse, http } from 'msw'

import { db, sql } from '../db'
import { ad, adAccount, adSet, campaign, client, organization } from '../db/schema'
import { MetaClient } from '../meta/client'
import { fakeMetaServer } from '../meta/fake/server'
import { createFakeMetaScaleRoster } from '../meta/fake/roster'
import { scheduleAccountDataRun } from '../sync/account-data'
import { metaCapacityConcurrency } from '../sync/capacity'
import { scheduleCreativeRun } from '../sync/creative'
import { scheduleHistoricalReconciliationRun } from '../sync/historical-reconciliation'
import { scheduleHierarchyRun } from '../sync/hierarchy'
import { scheduleInsightsRun } from '../sync/insights'

const scaleAgency = {
	id: 'fake-meta-scale-agency',
	name: 'Meta Scale Fixture Agency',
	slug: 'fake-meta-scale-agency',
} as const
const scaleRoster = createFakeMetaScaleRoster()
const scaleAccounts = scaleRoster.flatMap(scaleClient =>
	scaleClient.accounts.map(id => ({ id, clientId: scaleClient.id })),
)
const fakeMetaResponseLatencyMilliseconds = 5
const appExhaustedHeaders = { 'X-App-Usage': '{"call_count":100}' }
let inFlightRequests = 0
let peakInFlightRequests = 0

async function delayedResponse(body: Parameters<typeof HttpResponse.json>[0]) {
	inFlightRequests += 1
	peakInFlightRequests = Math.max(peakInFlightRequests, inFlightRequests)
	await new Promise(resolve => setTimeout(resolve, fakeMetaResponseLatencyMilliseconds))
	inFlightRequests -= 1
	return HttpResponse.json(body)
}

function buildOptions(now: Date) {
	return {
		agencyId: scaleAgency.id,
		trigger: 'cron' as const,
		metaMode: 'fake' as const,
		buildMetaClient: () => new MetaClient({ accessToken: 'scale-test-token', sleep: async () => undefined }),
		now,
		clock: () => now,
	}
}

describe('operational sync throughput', () => {
	beforeAll(async () => {
		fakeMetaServer.listen({ onUnhandledRequest: 'error' })
		await db.delete(organization).where(eq(organization.id, scaleAgency.id))
	})

	beforeEach(async () => {
		fakeMetaServer.resetHandlers()
		inFlightRequests = 0
		peakInFlightRequests = 0
		await db.delete(organization).where(eq(organization.id, scaleAgency.id))
		const now = new Date()
		await db.insert(organization).values({ ...scaleAgency, createdAt: now, updatedAt: now })
		await db.insert(client).values(
			scaleRoster.map(scaleClient => ({
				id: scaleClient.id,
				agencyId: scaleAgency.id,
				name: scaleClient.name,
				createdAt: now,
				updatedAt: now,
			})),
		)
		await db.insert(adAccount).values(
			scaleAccounts.map(account => ({
				...account,
				name: `Scale ${account.id}`,
				currency: 'USD',
				timezoneName: 'Europe/Kyiv',
				connectionStatus: 'connected' as const,
				accountDataNextDueAt: now,
				hierarchyNextDueAt: now,
				insightsNextDueAt: now,
				createdAt: now,
				updatedAt: now,
			})),
		)
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/:accountId/campaigns', () => delayedResponse({ data: [] })),
			http.get('https://graph.facebook.com/v25.0/:accountId/adsets', () => delayedResponse({ data: [] })),
			http.get('https://graph.facebook.com/v25.0/:accountId/ads', () => delayedResponse({ data: [] })),
			http.get('https://graph.facebook.com/v25.0/:accountId/insights', () => delayedResponse({ data: [] })),
			http.get('https://graph.facebook.com/v25.0/:accountId', ({ params }) =>
				delayedResponse({
					id: String(params.accountId).replace(/^act_/, ''),
					name: `Scale ${params.accountId}`,
					currency: 'USD',
					timezone_name: 'Europe/Kyiv',
					account_status: 1,
					disable_reason: 0,
					balance: '0',
					is_prepay_account: true,
				}),
			),
		)
	}, 30_000)

	afterAll(async () => {
		fakeMetaServer.close()
		await db.delete(organization).where(eq(organization.id, scaleAgency.id))
		await sql.end()
	})

	it('refreshes all Operational Slices for 150 Ad Accounts within the five-minute target', async () => {
		const now = new Date('2026-08-29T08:00:00.000Z')
		const startedAt = performance.now()
		const accountData = await scheduleAccountDataRun(buildOptions(now))
		const hierarchy = await scheduleHierarchyRun(buildOptions(now))
		const insights = await scheduleInsightsRun(buildOptions(now))
		const elapsedMilliseconds = performance.now() - startedAt

		for (const result of [accountData, hierarchy, insights]) {
			expect(result).toMatchObject({ status: 'completed', processed: 150, failed: 0, queued: 0 })
		}
		expect(peakInFlightRequests).toBe(metaCapacityConcurrency)
		expect(elapsedMilliseconds).toBeLessThan(5 * 60 * 1_000)
	}, 30_000)

	it('resumes queued Account data after Meta app capacity recovers', async () => {
		const now = new Date('2026-08-29T08:00:00.000Z')
		let appBudgetExhausted = true
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/:accountId', ({ params }) => {
				const body = {
					id: String(params.accountId).replace(/^act_/, ''),
					name: `Scale ${params.accountId}`,
					currency: 'USD',
					timezone_name: 'Europe/Kyiv',
					account_status: 1,
					disable_reason: 0,
					balance: '0',
					is_prepay_account: true,
				}
				return appBudgetExhausted
					? HttpResponse.json(body, { headers: appExhaustedHeaders })
					: delayedResponse(body)
			}),
		)

		const paused = await scheduleAccountDataRun(buildOptions(now))
		expect(paused).toMatchObject({ status: 'running', failed: 0 })
		expect(paused.queued).toBeGreaterThan(0)

		appBudgetExhausted = false
		const resumed = await scheduleAccountDataRun(buildOptions(new Date(now.getTime() + 61_000)))

		expect(resumed.runId).toBe(paused.runId)
		expect(resumed).toMatchObject({ status: 'completed', processed: 150, failed: 0, queued: 0 })
	}, 30_000)

	it('resumes queued Insights after Meta app capacity recovers', async () => {
		const now = new Date('2026-08-29T08:00:00.000Z')
		let appBudgetExhausted = true
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/:accountId/insights', () =>
				appBudgetExhausted
					? HttpResponse.json({ data: [] }, { headers: appExhaustedHeaders })
					: delayedResponse({ data: [] }),
			),
		)

		const paused = await scheduleInsightsRun(buildOptions(now))
		expect(paused).toMatchObject({ status: 'running', failed: 0 })
		expect(paused.queued).toBeGreaterThan(0)

		appBudgetExhausted = false
		const resumed = await scheduleInsightsRun(buildOptions(new Date(now.getTime() + 61_000)))

		expect(resumed.runId).toBe(paused.runId)
		expect(resumed).toMatchObject({ status: 'completed', processed: 150, failed: 0, queued: 0 })
	}, 30_000)

	it('resumes queued Creative enrichment after Meta app capacity recovers', async () => {
		const now = new Date('2026-08-29T08:00:00.000Z')
		await db
			.update(adAccount)
			.set({ creativeNextDueAt: now })
			.where(
				inArray(
					adAccount.id,
					scaleAccounts.map(account => account.id),
				),
			)
		await db.insert(campaign).values(
			scaleAccounts.map(account => ({
				id: `campaign_${account.id.slice(4)}`,
				adAccountId: account.id,
				name: `Campaign ${account.id}`,
				effectiveStatus: 'ACTIVE',
				createdAt: now,
				updatedAt: now,
			})),
		)
		await db.insert(adSet).values(
			scaleAccounts.map(account => ({
				id: `adset_${account.id.slice(4)}`,
				campaignId: `campaign_${account.id.slice(4)}`,
				name: `Ad Set ${account.id}`,
				effectiveStatus: 'ACTIVE',
				createdAt: now,
				updatedAt: now,
			})),
		)
		await db.insert(ad).values(
			scaleAccounts.map(account => ({
				id: `ad_${account.id.slice(4)}`,
				adSetId: `adset_${account.id.slice(4)}`,
				name: `Ad ${account.id}`,
				effectiveStatus: 'ACTIVE',
				createdAt: now,
				updatedAt: now,
			})),
		)

		let appBudgetExhausted = true
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/:adId', ({ params }) => {
				const adId = String(params.adId)
				const body = { id: adId, creative: { id: `creative_${adId}` } }
				return appBudgetExhausted
					? HttpResponse.json(body, { headers: appExhaustedHeaders })
					: delayedResponse(body)
			}),
		)

		const paused = await scheduleCreativeRun(buildOptions(now))
		expect(paused).toMatchObject({ status: 'running', failed: 0 })
		expect(paused.queued).toBeGreaterThan(0)

		appBudgetExhausted = false
		const resumed = await scheduleCreativeRun(buildOptions(new Date(now.getTime() + 61_000)))

		expect(resumed.runId).toBe(paused.runId)
		expect(resumed).toMatchObject({ status: 'completed', processed: 150, failed: 0, queued: 0 })
	}, 30_000)

	it('resumes queued Historical Reconciliation after Meta app capacity recovers', async () => {
		const now = new Date('2026-08-29T08:00:00.000Z')
		const reconciliationAccounts = scaleAccounts.slice(0, metaCapacityConcurrency + 1)
		await db
			.update(adAccount)
			.set({
				accountDataSuccessfulAt: now,
				hierarchySuccessfulAt: now,
				historicalReconciliationPendingDate: '2026-08-27',
			})
			.where(
				inArray(
					adAccount.id,
					reconciliationAccounts.map(account => account.id),
				),
			)

		let appBudgetExhausted = true
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/:accountId/insights', () =>
				appBudgetExhausted
					? HttpResponse.json({ data: [] }, { headers: appExhaustedHeaders })
					: delayedResponse({ data: [] }),
			),
		)

		const paused = await scheduleHistoricalReconciliationRun(buildOptions(now))
		expect(paused).toMatchObject({ status: 'running', failed: 0 })
		expect(paused.queued).toBeGreaterThan(0)

		appBudgetExhausted = false
		const resumed = await scheduleHistoricalReconciliationRun(buildOptions(new Date(now.getTime() + 61_000)))

		expect(resumed.runId).toBe(paused.runId)
		expect(resumed).toMatchObject({
			status: 'completed',
			processed: reconciliationAccounts.length,
			failed: 0,
			queued: 0,
		})
	}, 30_000)
})
