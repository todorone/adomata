import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { HttpResponse, http } from 'msw'

import { db, sql } from '../db'
import { adAccount, adInsight, organization, syncAccountOutcome, syncRun } from '../db/schema'
import { MetaClient } from '../meta/client'
import { fakeMetaServer } from '../meta/fake/server'
import { fakeMetaAccounts, fakeMetaAgency, seedFakeMetaRoster } from '../meta/fake/roster'
import { scheduleInsightsRun, type InsightsRunOptions } from '../sync/insights'
import { scheduleCreativeRun, type CreativeRunOptions } from '../sync/creative'
import { scheduleAccountDataRun, type AccountDataRunOptions } from '../sync/account-data'
import { scheduleHierarchyRun, type HierarchyRunOptions } from '../sync/hierarchy'

const fakeAccessToken = 'integration-test-token'
const successfulAccountIds = fakeMetaAccounts.filter(account => account.kind === 'success').map(account => account.id)

function buildMetaClient() {
	return new MetaClient({ accessToken: fakeAccessToken, sleep: async () => undefined })
}

function buildAccountDataOptions(now: Date): AccountDataRunOptions {
	return {
		agencyId: fakeMetaAgency.id,
		trigger: 'cron',
		metaMode: 'fake',
		buildMetaClient,
		now,
		clock: () => now,
	}
}

function buildHierarchyOptions(now: Date): HierarchyRunOptions {
	return {
		agencyId: fakeMetaAgency.id,
		trigger: 'cron',
		metaMode: 'fake',
		buildMetaClient,
		now,
		clock: () => now,
	}
}

function buildInsightsOptions(now: Date, commitAt = now): InsightsRunOptions {
	return {
		agencyId: fakeMetaAgency.id,
		trigger: 'cron',
		metaMode: 'fake',
		buildMetaClient,
		now,
		clock: () => commitAt,
	}
}

function buildCreativeOptions(now: Date): CreativeRunOptions {
	return {
		agencyId: fakeMetaAgency.id,
		trigger: 'cron',
		metaMode: 'fake',
		buildMetaClient,
		now,
		clock: () => now,
	}
}

async function prepareOperationalAccounts(now: Date, connectionStatus: 'pending' | 'connected' = 'connected') {
	await scheduleAccountDataRun(buildAccountDataOptions(now))
	await scheduleHierarchyRun(buildHierarchyOptions(now))
	await db
		.update(adAccount)
		.set({
			connectionStatus,
			insightsSuccessfulAt: new Date(now.getTime() - 60 * 60 * 1000),
			insightsNextDueAt: now,
			creativeNextDueAt: now,
		})
		.where(inArray(adAccount.id, successfulAccountIds))
}

describe('durable Insights and Creative work', () => {
	beforeAll(async () => {
		fakeMetaServer.listen({ onUnhandledRequest: 'error' })
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
	})

	beforeEach(async () => {
		fakeMetaServer.resetHandlers()
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
		await db.insert(organization).values({ ...fakeMetaAgency, createdAt: new Date(), updatedAt: new Date() })
		await seedFakeMetaRoster(fakeMetaAgency.id)
		await db.delete(syncAccountOutcome).where(eq(syncAccountOutcome.adAccountId, 'missing'))
	})

	afterAll(async () => {
		fakeMetaServer.close()
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
		await sql.end()
	})

	it("uses each Ad Account's local date and records the successful commit time", async () => {
		const now = new Date('2026-07-26T00:30:00.000Z')
		const committedAt = new Date('2026-07-26T00:30:03.000Z')
		await prepareOperationalAccounts(now)

		const result = await scheduleInsightsRun(buildInsightsOptions(now, committedAt))

		expect(result).toMatchObject({ status: 'completed', processed: 5, failed: 0, queued: 0 })
		const [insight] = await db
			.select()
			.from(adInsight)
			.where(and(eq(adInsight.adId, 'ad-001'), eq(adInsight.date, '2026-07-26')))
		expect(insight?.date).toBe('2026-07-26')
		const [westCoastInsight] = await db.select().from(adInsight).where(eq(adInsight.adId, 'ad-004'))
		expect(westCoastInsight?.date).toBe('2026-07-25')
		const [account] = await db
			.select({ successfulAt: adAccount.insightsSuccessfulAt })
			.from(adAccount)
			.where(eq(adAccount.id, 'act_100000000000001'))
		expect(account?.successfulAt).toEqual(committedAt)
		const [run] = await db
			.select({ completedAt: syncRun.completedAt })
			.from(syncRun)
			.where(eq(syncRun.id, result.runId))
		expect(run?.completedAt).toEqual(committedAt)

		const [outcome] = await db
			.select({ slice: syncAccountOutcome.slice, successfulCommitAt: syncAccountOutcome.successfulCommitAt })
			.from(syncAccountOutcome)
			.where(
				and(eq(syncAccountOutcome.runId, result.runId), eq(syncAccountOutcome.adAccountId, 'act_100000000000001')),
			)
		expect(outcome).toEqual({ slice: 'insights', successfulCommitAt: committedAt })
	})

	it('commits Insights for known Ads when the current hierarchy attempt fails', async () => {
		const initialAt = new Date('2026-07-26T08:00:00.000Z')
		await prepareOperationalAccounts(initialAt)
		const failedAt = new Date('2026-07-26T08:05:00.000Z')
		await db
			.update(adAccount)
			.set({ hierarchyNextDueAt: failedAt, insightsNextDueAt: failedAt })
			.where(eq(adAccount.id, 'act_100000000000001'))
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/act_100000000000001/campaigns', () =>
				HttpResponse.json(
					{ error: { message: 'temporary hierarchy failure', type: 'OAuthException', code: 1 } },
					{ status: 500 },
				),
			),
		)

		const hierarchy = await scheduleHierarchyRun(buildHierarchyOptions(failedAt))
		const insights = await scheduleInsightsRun(buildInsightsOptions(failedAt))

		expect(hierarchy.failed).toBe(1)
		expect(insights).toMatchObject({ status: 'completed', processed: 5, failed: 0 })
		const [account] = await db
			.select({ hierarchyAt: adAccount.hierarchySuccessfulAt, insightsAt: adAccount.insightsSuccessfulAt })
			.from(adAccount)
			.where(eq(adAccount.id, 'act_100000000000001'))
		expect(account?.hierarchyAt).toEqual(initialAt)
		expect(account?.insightsAt).toEqual(failedAt)
	})

	it('persists a Creative failure without rolling back successful Insights', async () => {
		const now = new Date('2026-07-26T08:00:00.000Z')
		await prepareOperationalAccounts(now, 'pending')
		const insights = await scheduleInsightsRun(buildInsightsOptions(now))
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/ad-001', () =>
				HttpResponse.json(
					{ error: { message: 'creative unavailable', type: 'OAuthException', code: 1 } },
					{ status: 500 },
				),
			),
		)

		const creative = await scheduleCreativeRun(buildCreativeOptions(now))

		expect(insights.status).toBe('completed')
		expect(creative.failed).toBeGreaterThan(0)
		const [account] = await db
			.select({
				insightsAt: adAccount.insightsSuccessfulAt,
				initialImportHistoryCompletedAt: adAccount.initialImportHistoryCompletedAt,
				creativeError: adAccount.creativeError,
				connectionStatus: adAccount.connectionStatus,
			})
			.from(adAccount)
			.where(eq(adAccount.id, 'act_100000000000001'))
		expect(account?.insightsAt).toEqual(now)
		expect(account?.initialImportHistoryCompletedAt).toEqual(now)
		expect(account?.connectionStatus).toBe('connected')
		expect(account?.creativeError).toContain('creative unavailable')
		const initialInsights = await db.select().from(adInsight).where(eq(adInsight.adId, 'ad-001'))
		expect(initialInsights).toHaveLength(91)
		const [insight] = await db
			.select()
			.from(adInsight)
			.where(and(eq(adInsight.adId, 'ad-001'), eq(adInsight.date, '2026-07-26')))
		expect(insight?.date).toBe('2026-07-26')
	})

	it('preserves stored Insights absent from a throttle-truncated page set', async () => {
		const now = new Date('2026-07-26T08:00:00.000Z')
		await prepareOperationalAccounts(now)
		await db.insert(adInsight).values({
			adId: 'ad-002',
			date: '2026-07-26',
			spend: '7.00',
			impressions: 70,
			inlineLinkClicks: 7,
			clicks: 0,
			actions: [],
			actionValues: [],
		})
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/act_100000000000001/insights', () =>
				HttpResponse.json(
					{
						data: [
							{
								ad_id: 'ad-001',
								date_start: '2026-07-26',
								spend: '1.00',
								impressions: '10',
								inline_link_clicks: '1',
								actions: [],
								action_values: [],
							},
						],
						paging: { next: 'https://graph.facebook.com/v25.0/act_100000000000001/insights?after=1' },
					},
					{ headers: { 'X-App-Usage': '{"call_count":100}' } },
				),
			),
		)

		await scheduleInsightsRun(buildInsightsOptions(now))

		const [stored] = await db
			.select({ adId: adInsight.adId, date: adInsight.date })
			.from(adInsight)
			.where(and(eq(adInsight.adId, 'ad-002'), eq(adInsight.date, '2026-07-26')))
		expect(stored).toEqual({ adId: 'ad-002', date: '2026-07-26' })
	})

	it('keeps a pending Ad Account outside the Fleet Board after a throttle-truncated import', async () => {
		const now = new Date('2026-07-26T08:00:00.000Z')
		await prepareOperationalAccounts(now, 'pending')
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/act_100000000000001/insights', () =>
				HttpResponse.json(
					{
						data: [
							{
								ad_id: 'ad-001',
								date_start: '2026-07-26',
								spend: '1.00',
								impressions: '10',
								inline_link_clicks: '1',
								actions: [],
								action_values: [],
							},
						],
						paging: { next: 'https://graph.facebook.com/v25.0/act_100000000000001/insights?after=1' },
					},
					{ headers: { 'X-App-Usage': '{"call_count":100}' } },
				),
			),
		)

		await scheduleInsightsRun(buildInsightsOptions(now))

		const [account] = await db
			.select({
				connectionStatus: adAccount.connectionStatus,
				initialImportHistoryCompletedAt: adAccount.initialImportHistoryCompletedAt,
			})
			.from(adAccount)
			.where(eq(adAccount.id, 'act_100000000000001'))
		expect(account).toEqual({ connectionStatus: 'pending', initialImportHistoryCompletedAt: null })
	})
})
