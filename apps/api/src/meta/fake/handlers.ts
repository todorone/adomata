import { HttpResponse, http } from 'msw'

import { accountTierFields } from '../client'
import {
	fakeMetaAccounts,
	fakeMetaAdSets,
	fakeMetaAds,
	fakeMetaCampaigns,
	fakeMetaCreatives,
	fakeMetaInsights,
} from './roster'

const graph = 'https://graph.facebook.com/v25.0'

function accountFor(id: string) {
	return fakeMetaAccounts.find(account => account.id === id)
}

function requireToken(request: Request) {
	return Boolean(new URL(request.url).searchParams.get('access_token'))
}

function paginate<T>(request: Request, data: readonly T[]) {
	const url = new URL(request.url)
	const start = Number(url.searchParams.get('after') ?? 0)
	const pageSize = 2
	const slice = data.slice(start, start + pageSize)
	const next = start + pageSize < data.length ? new URL(url) : undefined
	if (next) next.searchParams.set('after', String(start + pageSize))
	return HttpResponse.json({ data: slice, ...(next ? { paging: { next: next.toString() } } : {}) })
}

export const fakeMetaHandlers = [
	http.get(`${graph}/:accountId/campaigns`, ({ params, request }) => {
		if (!requireToken(request)) return graphContractError('Missing access token')
		if (new URL(request.url).searchParams.get('fields') !== 'id,name,effective_status,objective')
			return graphContractError('Unsupported Campaign fields requested')
		const id = String(params.accountId)
		if (!accountFor(id)) return graphContractError(`Unknown fake Meta account: ${id}`)
		return paginate(
			request,
			fakeMetaCampaigns
				.filter(campaign => campaign.adAccountId === id)
				.map(campaign => ({
					id: campaign.id,
					name: campaign.name,
					effective_status: campaign.effectiveStatus,
					objective: campaign.objective,
				})),
		)
	}),
	http.get(`${graph}/:accountId/adsets`, ({ params, request }) => {
		if (!requireToken(request)) return graphContractError('Missing access token')
		if (
			new URL(request.url).searchParams.get('fields') !==
			'id,campaign_id,name,effective_status,optimization_goal,promoted_object'
		)
			return graphContractError('Unsupported Ad Set fields requested')
		const accountId = String(params.accountId)
		const campaignIds = new Set(
			fakeMetaCampaigns.filter(campaign => campaign.adAccountId === accountId).map(campaign => campaign.id),
		)
		return paginate(
			request,
			fakeMetaAdSets
				.filter(adSet => campaignIds.has(adSet.campaignId))
				.map(adSet => ({
					id: adSet.id,
					campaign_id: adSet.campaignId,
					name: adSet.name,
					effective_status: adSet.effectiveStatus,
					optimization_goal: adSet.optimizationGoal,
					promoted_object: adSet.promotedObject,
				})),
		)
	}),
	http.get(`${graph}/:accountId/ads`, ({ params, request }) => {
		if (!requireToken(request)) return graphContractError('Missing access token')
		if (new URL(request.url).searchParams.get('fields') !== 'id,adset_id,name,effective_status')
			return graphContractError('Unsupported Ad fields requested')
		const accountId = String(params.accountId)
		const campaignIds = new Set(
			fakeMetaCampaigns.filter(campaign => campaign.adAccountId === accountId).map(campaign => campaign.id),
		)
		const adSetIds = new Set(fakeMetaAdSets.filter(adSet => campaignIds.has(adSet.campaignId)).map(adSet => adSet.id))
		return paginate(
			request,
			fakeMetaAds
				.filter(ad => adSetIds.has(ad.adSetId))
				.map(ad => ({ id: ad.id, adset_id: ad.adSetId, name: ad.name, effective_status: ad.effectiveStatus })),
		)
	}),
	http.get(`${graph}/:accountId/insights`, ({ params, request }) => {
		const url = new URL(request.url)
		if (!requireToken(request)) return graphContractError('Missing access token')
		if (url.searchParams.get('level') !== 'ad' || url.searchParams.get('time_increment') !== '1')
			return graphContractError('Unsupported Insights level')
		if (
			url.searchParams.get('fields') !==
			'ad_id,date_start,spend,impressions,inline_link_clicks,actions,action_values'
		)
			return graphContractError('Unsupported Insights fields requested')
		const range = JSON.parse(url.searchParams.get('time_range') ?? '{}') as { since?: string; until?: string }
		if (!range.since || !range.until) return graphContractError('Missing Insights time range')
		const accountId = String(params.accountId)
		const campaignIds = new Set(
			fakeMetaCampaigns.filter(campaign => campaign.adAccountId === accountId).map(campaign => campaign.id),
		)
		const adSetIds = new Set(fakeMetaAdSets.filter(adSet => campaignIds.has(adSet.campaignId)).map(adSet => adSet.id))
		const adIds = new Set(fakeMetaAds.filter(ad => adSetIds.has(ad.adSetId)).map(ad => ad.id))
		return paginate(
			request,
			fakeMetaInsights
				.filter(insight => adIds.has(insight.adId) && insight.date >= range.since! && insight.date <= range.until!)
				.map(insight => ({
					ad_id: insight.adId,
					date_start: insight.date,
					spend: insight.spend,
					impressions: insight.impressions,
					inline_link_clicks: insight.inlineLinkClicks,
					actions: insight.actions,
					action_values: insight.actionValues,
				})),
		)
	}),
	http.get(`${graph}/:adId`, ({ params, request }) => {
		const id = String(params.adId)
		const url = new URL(request.url)
		if (!requireToken(request)) return graphContractError('Missing access token')
		const account = accountFor(id)
		if (account) {
			if (url.searchParams.get('fields') !== accountTierFields.join(','))
				return graphContractError('Unsupported Graph fields requested')
			if (account.kind === 'throttle') {
				return HttpResponse.json(
					{
						error: {
							message: 'Application request limit reached',
							type: 'OAuthException',
							code: 4,
							fbtrace_id: 'fake-throttle',
						},
					},
					{ status: 400, headers: { 'X-App-Usage': '{"call_count":100,"total_cputime":100,"total_time":100}' } },
				)
			}
			if (account.kind === 'revoked') {
				return HttpResponse.json(
					{
						error: {
							message: 'Permission denied for this ad account',
							type: 'OAuthException',
							code: 10,
							fbtrace_id: 'fake-revoked',
						},
					},
					{ status: 400 },
				)
			}
			if (account.kind !== 'success') return graphContractError(`Unsupported fixture kind: ${account.kind}`)
			return HttpResponse.json({
				id: account.id,
				name: account.name,
				currency: account.currency,
				timezone_name: account.timezoneName,
				account_status: account.accountStatus,
				disable_reason: account.disableReason,
				balance: account.balance,
				is_prepay_account: account.isPrepayAccount,
				...(account.fundingSourceType === null
					? {}
					: { funding_source_details: { type: account.fundingSourceType } }),
			})
		}
		if (
			url.searchParams.get('fields') !==
			'creative{id,name,object_story_spec,asset_feed_spec,effective_object_story_id,effective_instagram_media_id,thumbnail_url,image_url,video_id,object_url}'
		)
			return graphContractError('Unsupported Creative fields requested')
		const creative = fakeMetaCreatives.find(candidate => candidate.adId === id)
		return HttpResponse.json({
			id,
			creative: creative ? { id: creative.id, name: creative.name, ...creative.payload } : null,
		})
	}),
	http.all('https://graph.facebook.com/*', ({ request }) =>
		graphContractError(`Unsupported fake Meta request: ${new URL(request.url).pathname}`),
	),
]

function graphContractError(message: string) {
	return HttpResponse.json({ error: { message, type: 'FakeMetaContractError', code: 1 } }, { status: 500 })
}
