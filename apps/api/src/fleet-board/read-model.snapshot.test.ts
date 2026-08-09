import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ad, adAccount, adInsight, adSet, campaign, client } from '../db/schema'

type QueryChain = PromiseLike<unknown> & {
	from: (...args: unknown[]) => QueryChain
	innerJoin: (...args: unknown[]) => QueryChain
	where: (...args: unknown[]) => QueryChain
}

const dbSelect = vi.hoisted(() => vi.fn())
const whereConditions = vi.hoisted(() => [] as unknown[])

vi.mock('../db', () => ({ db: { select: dbSelect } }))

const { readFleetBoardRoot } = await import('./read-model')

function chain(result: unknown): QueryChain {
	const self: QueryChain = {
		from: () => self,
		innerJoin: () => self,
		where: condition => {
			whereConditions.push(condition)
			return self
		},
		then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
	}
	return self
}

const accountRow = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'act_1',
		clientId: 'client_1',
		name: 'Account 1',
		currency: 'USD',
		timezoneName: 'UTC',
		connectionStatus: 'connected',
		balance: '10',
		metaAccountStatus: 1,
		metaDisableReason: 0,
		isPrepayAccount: true,
		lastPollError: null,
		accountTierRefreshedAt: new Date('2026-01-03T00:00:00.000Z'),
		insightsTierRefreshedAt: new Date('2026-01-03T00:00:00.000Z'),
		insightsTierError: null,
		...overrides,
	}) as typeof adAccount.$inferSelect

const clientRow = (id: string, agencyId: string, name: string) =>
	({ id, agencyId, name, deletedAt: null }) as typeof client.$inferSelect

const campaignRow = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'campaign_1',
		adAccountId: 'act_1',
		name: 'Campaign 1',
		effectiveStatus: 'ACTIVE',
		deletedAt: null,
		...overrides,
	}) as typeof campaign.$inferSelect

const adSetRow = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'adset_1',
		campaignId: 'campaign_1',
		name: 'Ad Set 1',
		effectiveStatus: 'ACTIVE',
		resultActionType: 'lead',
		deletedAt: null,
		...overrides,
	}) as typeof adSet.$inferSelect

const adRow = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'ad_1',
		adSetId: 'adset_1',
		name: 'Ad 1',
		effectiveStatus: 'ACTIVE',
		deletedAt: null,
		...overrides,
	}) as typeof ad.$inferSelect

const insightRow = (adId: string, date: string, spend: string) =>
	({
		adId,
		date,
		spend,
		impressions: 100,
		inlineLinkClicks: 10,
		actions: [{ action_type: 'lead', value: '1' }],
		actionValues: [],
	}) as typeof adInsight.$inferSelect

describe('Fleet Board complete snapshot read model', () => {
	beforeEach(() => {
		dbSelect.mockReset()
		whereConditions.length = 0
	})

	it('returns all live levels, empty branches, video metadata, and historical deleted contributions once', async () => {
		const firstAccount = accountRow()
		const secondAccount = accountRow({ id: 'act_2', clientId: 'client_2', name: 'Account 2' })
		const firstClient = clientRow('client_1', 'agency_1', 'Client 1')
		const secondClient = clientRow('client_2', 'agency_1', 'Client 2')
		const liveCampaign = campaignRow()
		const deletedCampaign = campaignRow({ id: 'campaign_deleted', name: 'Deleted campaign', deletedAt: new Date() })
		const liveAdSet = adSetRow()
		const emptyAdSet = adSetRow({ id: 'adset_empty', name: 'Empty Ad Set' })
		const deletedCampaignAdSet = adSetRow({ id: 'adset_deleted_campaign', campaignId: deletedCampaign.id })
		const liveAd = adRow()
		const deletedAd = adRow({ id: 'ad_deleted', name: 'Deleted ad', deletedAt: new Date() })
		const historicalAd = adRow({ id: 'ad_historical', adSetId: deletedCampaignAdSet.id })

		dbSelect
			.mockReturnValueOnce(
				chain([
					{ account: firstAccount, client: firstClient },
					{ account: secondAccount, client: secondClient },
				]),
			)
			.mockReturnValueOnce(chain([{ campaign: liveCampaign }, { campaign: deletedCampaign }]))
			.mockReturnValueOnce(
				chain([
					{ adSet: liveAdSet, campaign: liveCampaign },
					{ adSet: emptyAdSet, campaign: liveCampaign },
					{ adSet: deletedCampaignAdSet, campaign: deletedCampaign },
				]),
			)
			.mockReturnValueOnce(
				chain([
					{ ad: liveAd, adSet: liveAdSet, campaign: liveCampaign },
					{ ad: deletedAd, adSet: liveAdSet, campaign: liveCampaign },
					{ ad: historicalAd, adSet: deletedCampaignAdSet, campaign: deletedCampaign },
				]),
			)
			.mockReturnValueOnce(
				chain([
					{
						adId: liveAd.id,
						creativeId: 'creative_1',
						payload: { asset_feed_spec: { videos: [{ video_id: 'video_1' }] } },
					},
				]),
			)
			.mockReturnValueOnce(
				chain([
					{
						insight: insightRow(liveAd.id, '2026-01-01', '10'),
						ad: liveAd,
						adSet: liveAdSet,
						campaign: liveCampaign,
					},
					{
						insight: insightRow(deletedAd.id, '2026-01-01', '5'),
						ad: deletedAd,
						adSet: liveAdSet,
						campaign: liveCampaign,
					},
					{
						insight: insightRow(historicalAd.id, '2026-01-01', '20'),
						ad: historicalAd,
						adSet: deletedCampaignAdSet,
						campaign: deletedCampaign,
					},
					{
						insight: insightRow(liveAd.id, '2025-12-31', '100'),
						ad: liveAd,
						adSet: liveAdSet,
						campaign: liveCampaign,
					},
				]),
			)

		const response = await readFleetBoardRoot(
			'agency_1',
			{
				range: { start: '2026-01-01', end: '2026-01-02' },
				search: '',
				needsAttention: false,
				sort: 'name',
				direction: 'asc',
			},
			new Date('2026-01-03T00:00:00.000Z'),
		)

		expect(response.accounts).toHaveLength(2)
		expect(response.nodes.map(node => `${node.type}:${node.id}`)).toEqual([
			'campaign:campaign_1',
			'adset:adset_1',
			'adset:adset_empty',
			'ad:ad_1',
		])
		expect(response.nodes.find(node => node.type === 'ad')).toMatchObject({
			creativeId: 'creative_1',
			creativeHasVideo: true,
		})
		expect(response.nodes.find(node => node.id === 'adset_empty')?.kpis.spend).toBe('0')
		expect(response.accounts[0]?.kpis.spend).toBe('35')
		expect(response.nodes.find(node => node.id === 'campaign_1')?.kpis.spend).toBe('15')
		expect(new PgDialect().sqlToQuery(whereConditions[0] as never).params).toEqual(['agency_1'])
		expect(dbSelect).toHaveBeenCalledTimes(6)
	})
})
