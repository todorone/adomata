import { and, eq, gte, lte } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { HttpResponse, http } from 'msw'

import { db, sql } from '../db'
import { adAccount, adInsight, organization, syncAccountOutcome } from '../db/schema'
import { fakeMetaServer } from '../meta/fake/server'
import { fakeMetaAgency, seedFakeMetaRoster } from '../meta/fake/roster'
import { MetaClient } from '../meta/client'
import { scheduleAccountDataRun } from '../sync/account-data'
import { scheduleHierarchyRun } from '../sync/hierarchy'
import {
	scheduleHistoricalReconciliationRun,
	type HistoricalReconciliationRunOptions,
} from '../sync/historical-reconciliation'
import { scheduleInsightsRun } from '../sync/insights'

const fakeAccessToken = 'historical-reconciliation-test-token'
const accountId = 'act_100000000000001'

function buildMetaClient() {
	return new MetaClient({ accessToken: fakeAccessToken, sleep: async () => undefined })
}

function buildOptions(now: Date): HistoricalReconciliationRunOptions {
	return {
		agencyId: fakeMetaAgency.id,
		trigger: 'cron',
		metaMode: 'fake',
		buildMetaClient,
		now,
		clock: () => now,
	}
}

async function prepareConnectedAccount(now: Date) {
	await scheduleAccountDataRun({ ...buildOptions(now), agencyId: fakeMetaAgency.id })
	await scheduleHierarchyRun({ ...buildOptions(now), agencyId: fakeMetaAgency.id })
	await db
		.update(adAccount)
		.set({ connectionStatus: 'connected', insightsNextDueAt: now })
		.where(eq(adAccount.id, accountId))
}

describe('durable Historical Reconciliation', () => {
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

	it('reconciles exactly the prior 28 account-local days once per assigned night slot', async () => {
		const now = new Date('2026-07-26T01:25:00.000Z')
		await prepareConnectedAccount(now)

		const first = await scheduleHistoricalReconciliationRun(buildOptions(now))
		const second = await scheduleHistoricalReconciliationRun(buildOptions(now))

		expect(first).toMatchObject({ status: 'completed', processed: 1, failed: 0, queued: 0 })
		expect(second).toMatchObject({ status: 'completed', processed: 0, failed: 0, queued: 0 })

		const rows = await db
			.select({ date: adInsight.date })
			.from(adInsight)
			.where(and(eq(adInsight.adId, 'ad-001'), gte(adInsight.date, '2026-06-28'), lte(adInsight.date, '2026-07-25')))

		expect(rows).toHaveLength(28)
		expect(rows[0]?.date).toBe('2026-06-28')
		expect(rows.at(-1)?.date).toBe('2026-07-25')

		const [account] = await db
			.select({
				reconciliationDate: adAccount.historicalReconciliationDate,
				successfulAt: adAccount.historicalReconciliationSuccessfulAt,
				pendingDate: adAccount.historicalReconciliationPendingDate,
			})
			.from(adAccount)
			.where(eq(adAccount.id, accountId))
		expect(account).toEqual({
			reconciliationDate: '2026-07-25',
			successfulAt: now,
			pendingDate: null,
		})

		const outcomes = await db
			.select({ reconciliationDate: syncAccountOutcome.reconciliationDate })
			.from(syncAccountOutcome)
			.where(and(eq(syncAccountOutcome.runId, first.runId), eq(syncAccountOutcome.adAccountId, accountId)))
		expect(outcomes).toEqual([{ reconciliationDate: '2026-07-25' }])
	})

	it('skips account-scoped Historical Reconciliation throttles', async () => {
		const now = new Date('2026-07-26T01:25:00.000Z')
		await prepareConnectedAccount(now)
		fakeMetaServer.use(
			http.get(`https://graph.facebook.com/v25.0/${accountId}/insights`, () =>
				HttpResponse.json(
					{ data: [] },
					{
						headers: {
							'X-Ad-Account-Usage': '{"call_count":95,"estimated_time_to_regain_access":12}',
						},
					},
				),
			),
		)

		const result = await scheduleHistoricalReconciliationRun(buildOptions(now))
		const [outcome] = await db
			.select({ status: syncAccountOutcome.status })
			.from(syncAccountOutcome)
			.where(and(eq(syncAccountOutcome.runId, result.runId), eq(syncAccountOutcome.adAccountId, accountId)))

		expect(outcome).toEqual({ status: 'skipped' })
	})

	it("keeps a failed target date eligible for next-day retry without affecting today's Insights", async () => {
		const night = new Date('2026-07-26T01:25:00.000Z')
		await prepareConnectedAccount(night)
		const priorInsightsAt = new Date('2026-07-25T23:00:00.000Z')
		await db
			.update(adAccount)
			.set({ insightsSuccessfulAt: priorInsightsAt, insightsNextDueAt: night })
			.where(eq(adAccount.id, accountId))

		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/act_100000000000001/insights', () =>
				HttpResponse.json(
					{ error: { message: 'historical outage', type: 'OAuthException', code: 1 } },
					{ status: 500 },
				),
			),
		)
		const failed = await scheduleHistoricalReconciliationRun(buildOptions(night))
		expect(failed).toMatchObject({ status: 'failed', processed: 0, failed: 1 })

		const nextDay = new Date('2026-07-26T22:05:00.000Z')
		fakeMetaServer.resetHandlers()
		const retry = await scheduleHistoricalReconciliationRun(buildOptions(nextDay))
		expect(retry).toMatchObject({ status: 'completed', processed: 1, failed: 0 })

		const insights = await scheduleInsightsRun({
			...buildOptions(nextDay),
			trigger: 'cron',
		})
		expect(insights).toMatchObject({ status: 'completed', processed: 5, failed: 0 })

		const [account] = await db
			.select({
				historicalDate: adAccount.historicalReconciliationDate,
				historicalError: adAccount.historicalReconciliationError,
				insightsAt: adAccount.insightsSuccessfulAt,
			})
			.from(adAccount)
			.where(eq(adAccount.id, accountId))
		expect(account).toEqual({
			historicalDate: '2026-07-25',
			historicalError: null,
			insightsAt: nextDay,
		})
	})

	it('preserves stored history absent from a throttle-truncated page set', async () => {
		const now = new Date('2026-07-26T01:25:00.000Z')
		await prepareConnectedAccount(now)
		await db.insert(adInsight).values({
			adId: 'ad-002',
			date: '2026-07-25',
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
								date_start: '2026-07-25',
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

		await scheduleHistoricalReconciliationRun(buildOptions(now))

		const [stored] = await db
			.select({ adId: adInsight.adId, date: adInsight.date })
			.from(adInsight)
			.where(and(eq(adInsight.adId, 'ad-002'), eq(adInsight.date, '2026-07-25')))
		expect(stored).toEqual({ adId: 'ad-002', date: '2026-07-25' })
	})
})
