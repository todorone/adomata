import { describe, expect, it } from 'vitest'
import type { FleetBoardNode } from '@adomata/api/client'

import { fleetBoardParentKey, indexFleetBoardNodes } from '@/data/fleet-board'

const kpis = {
	spend: '0',
	impressions: 0,
	clicks: 0,
	ctr: null,
	cpa: null,
	cpaReason: null,
	results: null,
	roas: null,
	running: false,
}

describe('Fleet Board node index', () => {
	it('groups flat nodes by immediate parent and replaces duplicate IDs', () => {
		const nodes: FleetBoardNode[] = [
			{
				id: 'campaign-1',
				type: 'campaign',
				parentId: 'act-1',
				name: 'Old name',
				effectiveStatus: 'PAUSED',
				kpis,
				creativeId: null,
				creativeHasVideo: false,
			},
			{
				id: 'campaign-1',
				type: 'campaign',
				parentId: 'act-1',
				name: 'Current name',
				effectiveStatus: 'ACTIVE',
				kpis,
				creativeId: null,
				creativeHasVideo: false,
			},
			{
				id: 'adset-1',
				type: 'adset',
				parentId: 'campaign-1',
				name: 'Ad Set',
				effectiveStatus: 'ACTIVE',
				kpis,
				creativeId: null,
				creativeHasVideo: false,
			},
		]

		const index = indexFleetBoardNodes(nodes)

		expect(index[fleetBoardParentKey('account', 'act-1')]).toHaveLength(1)
		expect(index[fleetBoardParentKey('account', 'act-1')]?.[0]?.name).toBe('Current name')
		expect(index[fleetBoardParentKey('campaign', 'campaign-1')]?.[0]?.id).toBe('adset-1')
	})
})
