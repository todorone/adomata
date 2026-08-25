import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { HttpResponse, http } from 'msw'

import { db, sql } from '../db'
import { ad, adAccount, adSet, campaign, organization, syncAccountOutcome, syncRun } from '../db/schema'
import { MetaClient } from '../meta/client'
import { fakeMetaServer } from '../meta/fake/server'
import { fakeMetaAccounts, fakeMetaAgency, seedFakeMetaRoster } from '../meta/fake/roster'
import { enqueueAccountDataRun, runAccountDataGeneration, type AccountDataRunOptions } from '../sync/account-data'
import {
	enqueueHierarchyRun,
	runHierarchyGeneration,
	scheduleHierarchyRun,
	type HierarchyRunOptions,
} from '../sync/hierarchy'

const fakeAccessToken = 'integration-test-token'

function buildAccountDataOptions(now: Date): AccountDataRunOptions {
	return {
		agencyId: fakeMetaAgency.id,
		trigger: 'cron',
		metaMode: 'fake',
		buildMetaClient: () => new MetaClient({ accessToken: fakeAccessToken, sleep: async () => undefined }),
		now,
		clock: () => now,
	}
}

function buildHierarchyOptions(now: Date): HierarchyRunOptions {
	return {
		agencyId: fakeMetaAgency.id,
		trigger: 'cron',
		metaMode: 'fake',
		buildMetaClient: () => new MetaClient({ accessToken: fakeAccessToken, sleep: async () => undefined }),
		now,
		clock: () => now,
	}
}

describe('durable hierarchy work', () => {
	beforeAll(async () => {
		fakeMetaServer.listen({ onUnhandledRequest: 'error' })
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
	})

	beforeEach(async () => {
		fakeMetaServer.resetHandlers()
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
		await db.insert(organization).values({ ...fakeMetaAgency, createdAt: new Date(), updatedAt: new Date() })
		await seedFakeMetaRoster(fakeMetaAgency.id)
		await db.delete(syncRun).where(eq(syncRun.agencyId, fakeMetaAgency.id))
	})

	afterAll(async () => {
		fakeMetaServer.close()
		await db.delete(organization).where(eq(organization.id, fakeMetaAgency.id))
		await sql.end()
	})

	it('commits a complete enumeration and soft-deletes only after the next complete enumeration', async () => {
		const firstAt = new Date('2026-08-24T08:00:00.000Z')
		const options = buildHierarchyOptions(firstAt)
		const queued = await enqueueHierarchyRun(options)
		const first = await runHierarchyGeneration({ ...options, runId: queued.runId })

		expect(first).toMatchObject({ status: 'completed', processed: 7, failed: 0, queued: 0 })
		const [account] = await db
			.select({
				successfulAt: adAccount.hierarchySuccessfulAt,
				diagnosticReference: adAccount.hierarchyDiagnosticReference,
			})
			.from(adAccount)
			.where(eq(adAccount.id, 'act_100000000000001'))
		expect(account).toEqual({
			successfulAt: firstAt,
			diagnosticReference: `sync-run/${queued.runId}/hierarchy/act_100000000000001`,
		})

		const outcomes = await db
			.select({
				slice: syncAccountOutcome.slice,
				status: syncAccountOutcome.status,
				successfulCommitAt: syncAccountOutcome.successfulCommitAt,
			})
			.from(syncAccountOutcome)
			.where(eq(syncAccountOutcome.runId, queued.runId))
		expect(outcomes).toHaveLength(7)
		expect(outcomes.every(outcome => outcome.slice === 'hierarchy' && outcome.status === 'succeeded')).toBe(true)
		expect(outcomes.every(outcome => outcome.successfulCommitAt?.getTime() === firstAt.getTime())).toBe(true)

		const nextAt = new Date(firstAt.getTime() + 5 * 60 * 1000 + 1)
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/act_100000000000001/campaigns', () =>
				HttpResponse.json({ data: [] }),
			),
			http.get('https://graph.facebook.com/v25.0/act_100000000000001/adsets', () => HttpResponse.json({ data: [] })),
			http.get('https://graph.facebook.com/v25.0/act_100000000000001/ads', () => HttpResponse.json({ data: [] })),
		)

		const deleted = await scheduleHierarchyRun({ ...buildHierarchyOptions(nextAt), clock: () => nextAt })
		expect(deleted).toMatchObject({ status: 'completed', processed: 7, failed: 0 })

		const rows = await db
			.select({
				campaignId: campaign.id,
				campaignDeletedAt: campaign.deletedAt,
				adSetId: adSet.id,
				adSetDeletedAt: adSet.deletedAt,
				adId: ad.id,
				adDeletedAt: ad.deletedAt,
			})
			.from(campaign)
			.leftJoin(adSet, eq(adSet.campaignId, campaign.id))
			.leftJoin(ad, eq(ad.adSetId, adSet.id))
			.where(eq(campaign.adAccountId, 'act_100000000000001'))
		expect(rows).toHaveLength(3)
		expect(rows.every(row => row.campaignDeletedAt?.getTime() === nextAt.getTime())).toBe(true)
		expect(rows.every(row => row.adSetDeletedAt?.getTime() === nextAt.getTime())).toBe(true)
		expect(rows.every(row => row.adDeletedAt?.getTime() === nextAt.getTime())).toBe(true)
	})

	it('stops new hierarchy work when Meta reports an exhausted budget', async () => {
		const now = new Date('2026-08-24T08:00:00.000Z')
		await db
			.update(adAccount)
			.set({ connectionStatus: 'connected' })
			.where(
				inArray(
					adAccount.id,
					fakeMetaAccounts.filter(account => account.kind === 'success').map(account => account.id),
				),
			)
		let lowerPriorityCalls = 0
		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/act_100000000000005/campaigns', () =>
				HttpResponse.json({ data: [] }, { headers: { 'X-App-Usage': '{"call_count":100}' } }),
			),
			http.get('https://graph.facebook.com/v25.0/act_100000000000006/campaigns', () => {
				lowerPriorityCalls += 1
				return HttpResponse.json({ data: [] })
			}),
		)

		const result = await scheduleHierarchyRun(buildHierarchyOptions(now))

		expect(result).toMatchObject({ status: 'running', processed: 5, failed: 0, queued: 2 })
		expect(lowerPriorityCalls).toBe(0)
	})

	it('preserves the previous hierarchy and committed Account data after a partial enumeration failure', async () => {
		const firstAt = new Date('2026-08-24T09:00:00.000Z')
		const hierarchyOptions = buildHierarchyOptions(firstAt)
		const initial = await enqueueHierarchyRun(hierarchyOptions)
		await runHierarchyGeneration({ ...hierarchyOptions, runId: initial.runId })

		const accountOptions = buildAccountDataOptions(firstAt)
		const accountRun = await enqueueAccountDataRun(accountOptions)
		expect(accountRun.runId).not.toBe(initial.runId)
		await runAccountDataGeneration({ ...accountOptions, runId: accountRun.runId })
		const [accountOutcome] = await db
			.select({
				slice: syncAccountOutcome.slice,
				successfulCommitAt: syncAccountOutcome.successfulCommitAt,
				diagnosticReference: syncAccountOutcome.diagnosticReference,
			})
			.from(syncAccountOutcome)
			.where(
				and(
					eq(syncAccountOutcome.runId, accountRun.runId),
					eq(syncAccountOutcome.adAccountId, 'act_100000000000001'),
				),
			)
			.limit(1)
		expect(accountOutcome).toEqual({
			slice: 'account_data',
			successfulCommitAt: firstAt,
			diagnosticReference: `sync-run/${accountRun.runId}/account-data/act_100000000000001`,
		})

		fakeMetaServer.use(
			http.get('https://graph.facebook.com/v25.0/act_100000000000001/ads', ({ request }) => {
				const url = new URL(request.url)
				if (!url.searchParams.has('after'))
					return HttpResponse.json({
						data: [
							{ id: 'ad-001', adset_id: 'adset-001', name: 'Image lead', effective_status: 'ACTIVE' },
							{ id: 'ad-002', adset_id: 'adset-001', name: 'Carousel lead', effective_status: 'ACTIVE' },
						],
						paging: { next: 'https://graph.facebook.com/v25.0/act_100000000000001/ads?after=2' },
					})
				return HttpResponse.json(
					{ error: { message: 'temporary Meta failure', type: 'OAuthException', code: 1 } },
					{ status: 500 },
				)
			}),
		)

		const failedAt = new Date(firstAt.getTime() + 5 * 60 * 1000 + 1)
		const failed = await scheduleHierarchyRun({ ...buildHierarchyOptions(failedAt), clock: () => failedAt })
		expect(failed).toMatchObject({ status: 'failed', processed: 6, failed: 1, queued: 0 })

		const [account] = await db
			.select({
				accountDataSuccessfulAt: adAccount.accountDataSuccessfulAt,
				hierarchySuccessfulAt: adAccount.hierarchySuccessfulAt,
				hierarchyError: adAccount.hierarchyError,
			})
			.from(adAccount)
			.where(eq(adAccount.id, 'act_100000000000001'))
		expect(account?.accountDataSuccessfulAt).toEqual(firstAt)
		expect(account?.hierarchySuccessfulAt).toEqual(firstAt)
		expect(account?.hierarchyError).toContain('temporary Meta failure')

		const [unchanged] = await db
			.select({ campaignDeletedAt: campaign.deletedAt, adSetDeletedAt: adSet.deletedAt, adDeletedAt: ad.deletedAt })
			.from(campaign)
			.innerJoin(adSet, eq(adSet.campaignId, campaign.id))
			.innerJoin(ad, eq(ad.adSetId, adSet.id))
			.where(eq(campaign.id, 'campaign-001'))
		expect(unchanged).toEqual({ campaignDeletedAt: null, adSetDeletedAt: null, adDeletedAt: null })

		const hierarchyOutcome = await db
			.select({ status: syncAccountOutcome.status, error: syncAccountOutcome.error })
			.from(syncAccountOutcome)
			.where(inArray(syncAccountOutcome.runId, [failed.runId]))
		expect(hierarchyOutcome.find(outcome => outcome.status === 'failed')?.error).toContain('temporary Meta failure')
	})
})
