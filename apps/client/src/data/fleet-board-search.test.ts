import { describe, expect, it } from 'vitest'

import { fleetBoardSearchSchema } from './fleet-board-search'

describe('Fleet Board URL state', () => {
	it('uses defaults without requiring a bare URL rewrite', () => {
		expect(fleetBoardSearchSchema.parse({})).toEqual({
			view: 'tree',
			range: 'last7',
			metrics: ['spend', 'clicks', 'cpa', 'results'],
			group: 'client',
			depth: 'account',
			search: '',
			needsAttention: false,
			hidePaused: false,
			sort: 'attention',
			direction: 'desc',
		})
	})

	it('drops invalid metrics and resets a hidden sort to Needs Attention', () => {
		expect(
			fleetBoardSearchSchema.parse({ metrics: 'clicks,unknown', sort: 'spend', direction: 'asc' }),
		).toMatchObject({
			metrics: ['clicks'],
			sort: 'attention',
			direction: 'asc',
		})
	})

	it('falls back to the default selection when every metric is unknown', () => {
		expect(fleetBoardSearchSchema.parse({ metrics: 'unknown' })).toMatchObject({
			metrics: ['spend', 'clicks', 'cpa', 'results'],
		})
	})

	it('keeps sorts that are not metric columns regardless of the selection', () => {
		expect(fleetBoardSearchSchema.parse({ metrics: 'clicks', sort: 'owed' })).toMatchObject({ sort: 'owed' })
		expect(fleetBoardSearchSchema.parse({ metrics: 'clicks', sort: 'name' })).toMatchObject({ sort: 'name' })
	})

	it('round-trips the paused-row rendering toggle and defaults it to off', () => {
		expect(fleetBoardSearchSchema.parse({ hidePaused: 'true' })).toMatchObject({ hidePaused: true })
		expect(fleetBoardSearchSchema.parse({ hidePaused: true })).toMatchObject({ hidePaused: true })
		expect(fleetBoardSearchSchema.parse({ hidePaused: 'false' })).toMatchObject({ hidePaused: false })
	})

	it('accepts normalized search values after the router serializes them', () => {
		expect(fleetBoardSearchSchema.parse({ metrics: ['spend', 'roas'], needsAttention: false })).toMatchObject({
			metrics: ['spend', 'roas'],
			needsAttention: false,
		})
	})
})
