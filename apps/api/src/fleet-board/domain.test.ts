import { describe, expect, it } from 'vitest'

import {
	classifyAccountHealth,
	dateRangeForAccount,
	firstConnectStart,
	isProvisional,
	isStale,
	reconciliationWindow,
	rollupKpis,
	rollupMetricsForClient,
	signalLaneFor,
	summarizeClientHealth,
	summarizeFleetTier,
} from './domain'

describe('Fleet Board domain rules', () => {
	it('classifies raw connection and Meta health without treating postpay as attention', () => {
		expect(classifyAccountHealth({ connectionStatus: 'pending' })).toMatchObject({
			color: 'grey',
			reason: { code: 'connection_pending' },
			needsAttention: false,
		})
		expect(classifyAccountHealth({ connectionStatus: 'access_lost' })).toMatchObject({
			color: 'grey',
			reason: { code: 'connection_access_lost' },
			needsAttention: true,
		})
		expect(
			classifyAccountHealth({
				connectionStatus: 'connected',
				metaAccountStatus: 2,
				metaDisableReason: 3,
			}),
		).toMatchObject({ color: 'red', reason: { code: 'meta_disabled' }, needsAttention: true })
		expect(
			classifyAccountHealth({
				connectionStatus: 'connected',
				metaAccountStatus: 1,
				isPrepayAccount: false,
			}),
		).toMatchObject({ color: 'yellow', reason: { code: 'postpay' }, needsAttention: false })
	})

	it('places account states in the priority Signals lanes', () => {
		expect(signalLaneFor({ color: 'red', needsAttention: true })).toBe('needs_attention')
		expect(signalLaneFor({ color: 'grey', needsAttention: true })).toBe('needs_attention')
		expect(signalLaneFor({ color: 'yellow', needsAttention: false })).toBe('postpay')
		expect(signalLaneFor({ color: 'green', needsAttention: false })).toBe('active')
		expect(signalLaneFor({ color: 'grey', needsAttention: false })).toBe('awaiting_data')
	})

	it('rolls client health up by worst useful signal and summary counts', () => {
		expect(
			summarizeClientHealth([
				{ color: 'green', needsAttention: false },
				{ color: 'grey', needsAttention: true },
				{ color: 'yellow', needsAttention: false },
			]),
		).toEqual({ color: 'yellow', needsAttention: true, reason: { code: 'client_attention', count: 1, total: 3 } })
		expect(
			summarizeClientHealth([
				{ color: 'red', needsAttention: true },
				{ color: 'red', needsAttention: true },
				{ color: 'green', needsAttention: false },
			]),
		).toEqual({ color: 'red', needsAttention: true, reason: { code: 'client_attention', count: 2, total: 3 } })
	})

	it('uses every account local timezone for ranges across opposite sides of midnight and DST', () => {
		const now = new Date('2026-03-29T00:30:00.000Z')
		expect(dateRangeForAccount('today', 'Europe/Kyiv', now)).toEqual({ start: '2026-03-29', end: '2026-03-29' })
		expect(dateRangeForAccount('today', 'America/Los_Angeles', now)).toEqual({
			start: '2026-03-28',
			end: '2026-03-28',
		})
		expect(dateRangeForAccount('last7', 'Europe/Kyiv', now)).toEqual({ start: '2026-03-23', end: '2026-03-29' })
		expect(dateRangeForAccount('month', 'America/Los_Angeles', now)).toEqual({
			start: '2026-03-01',
			end: '2026-03-28',
		})
	})

	it('keeps the 28 prior complete days reconcilable and backfills first sync to the earlier boundary', () => {
		const now = new Date('2026-08-01T00:30:00.000Z')
		expect(reconciliationWindow('Europe/Kyiv', now)).toEqual({ start: '2026-07-04', end: '2026-08-01' })
		expect(firstConnectStart('Europe/Kyiv', now)).toBe('2026-07-04')
		expect(isProvisional({ start: '2026-06-01', end: '2026-07-03' }, 'Europe/Kyiv', now)).toBe(false)
		expect(isProvisional({ start: '2026-06-01', end: '2026-07-04' }, 'Europe/Kyiv', now)).toBe(true)
		expect(isStale(new Date('2026-08-01T00:19:59.999Z'), 10 * 60 * 1000, now)).toBe(true)
		expect(isStale(new Date('2026-08-01T00:20:00.000Z'), 10 * 60 * 1000, now)).toBe(false)
	})

	it('reports the oldest successful refresh and counts never-synced accounts separately', () => {
		const neverSynced = { refreshedAt: null, stale: true }
		const oldest = { refreshedAt: '2026-07-30T08:00:00.000Z', stale: true }
		const newest = { refreshedAt: '2026-07-30T09:30:00.000Z', stale: false }

		expect(summarizeFleetTier([newest, oldest])).toEqual({
			refreshedAt: oldest.refreshedAt,
			stale: true,
			neverSynced: 0,
		})
		// A never-synced account is excluded rather than nulling the tier, and does not
		// change the stale flag the synced accounts already produced.
		expect(summarizeFleetTier([newest, oldest, neverSynced])).toEqual({
			refreshedAt: oldest.refreshedAt,
			stale: true,
			neverSynced: 1,
		})
		expect(summarizeFleetTier([newest, neverSynced, neverSynced])).toEqual({
			refreshedAt: newest.refreshedAt,
			stale: false,
			neverSynced: 2,
		})
		// Null only when no visible Ad Account has ever synced this tier.
		expect(summarizeFleetTier([neverSynced])).toEqual({ refreshedAt: null, stale: false, neverSynced: 1 })
		expect(summarizeFleetTier([])).toEqual({ refreshedAt: null, stale: false, neverSynced: 0 })
	})

	it('derives rollup KPIs from additive values with exact decimal arithmetic', () => {
		const kpis = rollupKpis([
			{
				spend: '10.10',
				impressions: 100,
				inlineLinkClicks: 4,
				resultActionType: 'lead',
				resultCount: '2',
				purchaseValue: '0',
				running: true,
			},
			{
				spend: '0.20',
				impressions: 100,
				inlineLinkClicks: 6,
				resultActionType: 'lead',
				resultCount: '1',
				purchaseValue: '20.60',
				running: false,
			},
		])
		expect(kpis).toEqual({
			spend: '10.3',
			impressions: 200,
			clicks: 10,
			ctr: '0.05',
			cpa: '3.433333',
			cpaReason: null,
			roas: '2',
			running: true,
		})
	})

	it('returns CPA reasons instead of mixing action types and does not invent zero denominators', () => {
		expect(
			rollupKpis([
				{
					spend: '10',
					impressions: 0,
					inlineLinkClicks: 0,
					resultActionType: 'lead',
					resultCount: '1',
					purchaseValue: '0',
					running: false,
				},
				{
					spend: '10',
					impressions: 0,
					inlineLinkClicks: 0,
					resultActionType: 'purchase',
					resultCount: '1',
					purchaseValue: '0',
					running: false,
				},
			]),
		).toMatchObject({ ctr: null, cpa: null, cpaReason: 'mixed_result_types', roas: '0' })
		expect(
			rollupKpis([
				{
					spend: '10',
					impressions: 1,
					inlineLinkClicks: 0,
					resultActionType: null,
					resultCount: null,
					purchaseValue: '0',
					running: false,
				},
			]),
		).toMatchObject({ cpa: null, cpaReason: 'unresolved_result_type' })
	})

	it('does not aggregate monetary client KPIs across currencies but preserves safe CTR', () => {
		const result = rollupMetricsForClient([
			{
				currency: 'USD',
				spend: '10',
				impressions: 100,
				inlineLinkClicks: 10,
				resultActionType: 'lead',
				resultCount: '1',
				purchaseValue: '20',
				running: true,
			},
			{
				currency: 'EUR',
				spend: '10',
				impressions: 100,
				inlineLinkClicks: 10,
				resultActionType: 'lead',
				resultCount: '1',
				purchaseValue: '20',
				running: false,
			},
		])
		expect(result).toEqual({
			unsupported: 'mixed_currency',
			spend: null,
			impressions: 200,
			clicks: 20,
			ctr: '0.1',
			cpa: null,
			cpaReason: null,
			roas: null,
			running: true,
		})
	})
})
