import { describe, expect, it } from 'vitest'

import { fleetBoardRootResponseSchema } from './fleet-board'

const kpis = {
	spend: '10',
	impressions: 100,
	clicks: 5,
	ctr: '0.05',
	cpa: null,
	cpaReason: null,
	results: null,
	roas: null,
	running: true,
}

describe('Fleet Board snapshot contract', () => {
	it('accepts roots and all flat live hierarchy levels in one response', () => {
		const response = fleetBoardRootResponseSchema.parse({
			clients: [],
			accounts: [],
			nodes: [
				{
					id: 'campaign-1',
					type: 'campaign',
					parentId: 'act_1',
					name: 'Campaign',
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
				{
					id: 'ad-1',
					type: 'ad',
					parentId: 'adset-1',
					name: 'Ad',
					effectiveStatus: 'ACTIVE',
					kpis,
					creativeId: 'creative-1',
					creativeHasVideo: true,
				},
			],
			header: {
				accountTierRefreshedAt: null,
				insightsTierRefreshedAt: null,
				accountTierStale: false,
				insightsTierStale: false,
				accountTierNeverSynced: 0,
				insightsTierNeverSynced: 0,
				provisional: false,
			},
		})

		expect(response.nodes.map(node => node.type)).toEqual(['campaign', 'adset', 'ad'])
		expect(response.nodes[2]).toMatchObject({ creativeId: 'creative-1', creativeHasVideo: true })
	})
})
