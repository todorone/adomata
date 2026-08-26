import { describe, expect, it } from 'vitest'

import {
	classifyAccountHealth,
	classifySyncHealth,
	dateRangeForAccount,
	firstConnectStart,
	isProvisional,
	isStale,
	reconciliationWindow,
	rollupKpis,
	signalLaneFor,
	type SyncSliceInput,
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
		expect(signalLaneFor({ color: 'grey', needsAttention: false })).toBe('active')
	})

	it('uses every account local timezone for ranges across opposite sides of midnight and DST', () => {
		// 2026-03-29 is a Sunday.
		const now = new Date('2026-03-29T00:30:00.000Z')
		expect(dateRangeForAccount('today', 'Europe/Kyiv', now)).toEqual({ start: '2026-03-29', end: '2026-03-29' })
		expect(dateRangeForAccount('today', 'America/Los_Angeles', now)).toEqual({
			start: '2026-03-28',
			end: '2026-03-28',
		})
		expect(dateRangeForAccount('yesterday', 'Europe/Kyiv', now)).toEqual({ start: '2026-03-28', end: '2026-03-28' })
		expect(dateRangeForAccount('last7', 'Europe/Kyiv', now)).toEqual({ start: '2026-03-23', end: '2026-03-29' })
		expect(dateRangeForAccount('last14', 'Europe/Kyiv', now)).toEqual({ start: '2026-03-16', end: '2026-03-29' })
		expect(dateRangeForAccount('last30', 'Europe/Kyiv', now)).toEqual({ start: '2026-02-28', end: '2026-03-29' })
		expect(dateRangeForAccount('thisWeek', 'Europe/Kyiv', now)).toEqual({ start: '2026-03-29', end: '2026-03-29' })
		expect(dateRangeForAccount('lastWeek', 'Europe/Kyiv', now)).toEqual({ start: '2026-03-22', end: '2026-03-28' })
		expect(dateRangeForAccount('thisMonth', 'America/Los_Angeles', now)).toEqual({
			start: '2026-03-01',
			end: '2026-03-28',
		})
		expect(dateRangeForAccount('lastMonth', 'Europe/Kyiv', now)).toEqual({ start: '2026-02-01', end: '2026-02-28' })
		expect(dateRangeForAccount({ start: '2026-01-05', end: '2026-01-11' }, 'Europe/Kyiv', now)).toEqual({
			start: '2026-01-05',
			end: '2026-01-11',
		})
	})

	it('keeps the 28 prior complete days reconcilable and backfills first sync by 90 local days', () => {
		const now = new Date('2026-08-01T00:30:00.000Z')
		expect(reconciliationWindow('Europe/Kyiv', now)).toEqual({ start: '2026-07-04', end: '2026-08-01' })
		expect(firstConnectStart('Europe/Kyiv', now)).toBe('2026-05-03')
		expect(isProvisional({ start: '2026-06-01', end: '2026-07-03' }, 'Europe/Kyiv', now)).toBe(false)
		expect(isProvisional({ start: '2026-06-01', end: '2026-07-04' }, 'Europe/Kyiv', now)).toBe(true)
		expect(isStale(new Date('2026-08-01T00:19:59.999Z'), 10 * 60 * 1000, now)).toBe(true)
		expect(isStale(new Date('2026-08-01T00:20:00.000Z'), 10 * 60 * 1000, now)).toBe(false)
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
			results: '3',
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
		).toMatchObject({ ctr: null, cpa: null, cpaReason: 'mixed_result_types', results: null, roas: '0' })
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
		).toMatchObject({ cpa: null, cpaReason: 'unresolved_result_type', results: null })
	})

	describe('classifySyncHealth', () => {
		const now = new Date('2026-08-01T12:00:00.000Z')
		const fresh = new Date('2026-08-01T11:58:00.000Z') // 2 minutes ago
		const staleSince = new Date('2026-08-01T11:00:00.000Z') // 60 minutes ago

		function slice(overrides: Partial<SyncSliceInput> = {}): SyncSliceInput {
			return {
				slice: 'account_data',
				successfulAt: fresh,
				attemptedAt: fresh,
				error: null,
				diagnosticReference: null,
				metaErrorCode: null,
				...overrides,
			}
		}

		it('reports no synchronization health issue when every slice is fresh', () => {
			expect(
				classifySyncHealth({
					connectionStatus: 'connected',
					slices: [slice({ slice: 'account_data' }), slice({ slice: 'hierarchy' }), slice({ slice: 'insights' })],
					latestForceRefreshRequestedAt: null,
					now,
				}),
			).toBeNull()
		})

		it('marks every slice red for access_lost regardless of individual slice freshness', () => {
			const health = classifySyncHealth({
				connectionStatus: 'access_lost',
				slices: [slice({ slice: 'account_data' }), slice({ slice: 'hierarchy' })],
				latestForceRefreshRequestedAt: null,
				now,
			})
			expect(health).toMatchObject({
				severity: 'red',
				findings: [
					{ slice: 'account_data', severity: 'red', reason: 'access_lost' },
					{ slice: 'hierarchy', severity: 'red', reason: 'access_lost' },
				],
			})
		})

		it('hides a scheduled failure while the last-known snapshot is still fresh', () => {
			expect(
				classifySyncHealth({
					connectionStatus: 'connected',
					slices: [slice({ successfulAt: fresh, attemptedAt: now, error: 'transient upstream error' })],
					latestForceRefreshRequestedAt: null,
					now,
				}),
			).toBeNull()
		})

		it('surfaces a yellow triangle once an operational slice goes stale past 10 minutes', () => {
			const health = classifySyncHealth({
				connectionStatus: 'connected',
				slices: [slice({ successfulAt: staleSince, attemptedAt: staleSince })],
				latestForceRefreshRequestedAt: null,
				now,
			})
			expect(health).toMatchObject({ severity: 'yellow', findings: [{ reason: 'stale', severity: 'yellow' }] })
		})

		it('surfaces a red circle when a slice has no usable last-known snapshot at all', () => {
			const health = classifySyncHealth({
				connectionStatus: 'connected',
				slices: [slice({ successfulAt: null, attemptedAt: staleSince, error: 'never synced' })],
				latestForceRefreshRequestedAt: null,
				now,
			})
			expect(health).toMatchObject({ severity: 'red', findings: [{ reason: 'no_snapshot', severity: 'red' }] })
		})

		it('leaves Historical Reconciliation fresh under 36 hours and stale past it', () => {
			const thirtyFiveHoursAgo = new Date(now.getTime() - 35 * 60 * 60 * 1000)
			const thirtySevenHoursAgo = new Date(now.getTime() - 37 * 60 * 60 * 1000)
			expect(
				classifySyncHealth({
					connectionStatus: 'connected',
					slices: [slice({ slice: 'historical_reconciliation', successfulAt: thirtyFiveHoursAgo })],
					latestForceRefreshRequestedAt: null,
					now,
				}),
			).toBeNull()
			expect(
				classifySyncHealth({
					connectionStatus: 'connected',
					slices: [slice({ slice: 'historical_reconciliation', successfulAt: thirtySevenHoursAgo })],
					latestForceRefreshRequestedAt: null,
					now,
				}),
			).toMatchObject({ severity: 'yellow', findings: [{ reason: 'reconciliation_overdue' }] })
		})

		it('shows a failed Force Refresh immediately, yellow with usable data and red without it', () => {
			const requestedAt = new Date('2026-08-01T11:59:00.000Z')
			const attemptedAfterRequest = new Date('2026-08-01T11:59:30.000Z')
			const withUsableData = classifySyncHealth({
				connectionStatus: 'connected',
				slices: [
					slice({
						successfulAt: staleSince, // old, but still a usable last-known snapshot
						attemptedAt: attemptedAfterRequest,
						error: 'Force Refresh attempt failed',
					}),
				],
				latestForceRefreshRequestedAt: requestedAt,
				now,
			})
			expect(withUsableData).toMatchObject({
				severity: 'yellow',
				findings: [{ reason: 'force_refresh_failed', severity: 'yellow' }],
			})

			const withoutUsableData = classifySyncHealth({
				connectionStatus: 'connected',
				slices: [
					slice({
						successfulAt: null,
						attemptedAt: attemptedAfterRequest,
						error: 'Force Refresh attempt failed',
					}),
				],
				latestForceRefreshRequestedAt: requestedAt,
				now,
			})
			expect(withoutUsableData).toMatchObject({
				severity: 'red',
				findings: [{ reason: 'force_refresh_failed', severity: 'red' }],
			})
		})

		it('does not treat a stale attempt that predates the latest Force Refresh as a Force Refresh failure', () => {
			const requestedAt = new Date('2026-08-01T11:59:00.000Z')
			const health = classifySyncHealth({
				connectionStatus: 'connected',
				slices: [slice({ successfulAt: staleSince, attemptedAt: staleSince, error: 'an older scheduled failure' })],
				latestForceRefreshRequestedAt: requestedAt,
				now,
			})
			expect(health).toMatchObject({ findings: [{ reason: 'stale' }] })
		})

		it('surfaces an unrecoverable Meta validation failure as red immediately, bypassing the staleness grace period', () => {
			const health = classifySyncHealth({
				connectionStatus: 'connected',
				slices: [slice({ successfulAt: fresh, attemptedAt: now, error: 'Invalid parameter', metaErrorCode: 100 })],
				latestForceRefreshRequestedAt: null,
				now,
			})
			expect(health).toMatchObject({
				severity: 'red',
				findings: [{ reason: 'validation_failure', severity: 'red', metaErrorCode: 100 }],
			})
		})

		it('treats a rate-limit code as self-healing rather than an unrecoverable validation failure', () => {
			expect(
				classifySyncHealth({
					connectionStatus: 'connected',
					slices: [slice({ successfulAt: fresh, attemptedAt: now, error: 'Throttled', metaErrorCode: 4 })],
					latestForceRefreshRequestedAt: null,
					now,
				}),
			).toBeNull()
		})

		it('escalates the account to red when any one slice is red even if others are only yellow', () => {
			const health = classifySyncHealth({
				connectionStatus: 'connected',
				slices: [
					slice({ slice: 'account_data', successfulAt: staleSince, attemptedAt: staleSince }),
					slice({ slice: 'insights', successfulAt: null, attemptedAt: staleSince, error: 'never synced' }),
				],
				latestForceRefreshRequestedAt: null,
				now,
			})
			expect(health).toMatchObject({
				severity: 'red',
				findings: [
					{ slice: 'account_data', reason: 'stale', severity: 'yellow' },
					{ slice: 'insights', reason: 'no_snapshot', severity: 'red' },
				],
			})
		})
	})
})
