import { describe, expect, it } from 'vitest'

import { fleetBoardSearchSchema } from './fleet-board-search'

describe('Fleet Board URL state', () => {
	it('uses defaults without requiring a bare URL rewrite', () => {
		expect(fleetBoardSearchSchema.parse({})).toEqual({
			view: 'tree',
			range: 'today',
			metrics: ['spend', 'roas'],
			group: 'client',
			depth: 'account',
			search: '',
			needsAttention: false,
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
})
