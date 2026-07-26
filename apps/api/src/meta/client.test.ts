import { describe, expect, it, vi } from 'vitest'

import { MetaApiError, MetaClient } from './client'

const fields =
	'id,name,currency,timezone_name,account_status,disable_reason,balance,is_prepay_account,funding_source_details'

describe('MetaClient', () => {
	it('makes the strict Account Tier Graph request and normalizes raw signals', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: '100000000000001',
					name: 'Funded prepay',
					currency: 'USD',
					account_status: 1,
					disable_reason: 0,
					balance: '0',
					is_prepay_account: true,
					timezone_name: 'Europe/Kyiv',
					funding_source_details: { type: 20 },
				}),
				{ status: 200 },
			),
		)
		const client = new MetaClient({ accessToken: 'access token', fetch })

		await expect(client.getAccount('100000000000001')).resolves.toMatchObject({
			id: 'act_100000000000001',
			name: 'Funded prepay',
			currency: 'USD',
			metaAccountStatus: 1,
			metaDisableReason: 0,
			balance: '0',
			isPrepayAccount: true,
			fundingSourceType: 20,
			timezoneName: 'Europe/Kyiv',
		})

		const [url] = fetch.mock.calls[0] as [string]
		const request = new URL(url)
		expect(request.origin + request.pathname).toBe('https://graph.facebook.com/v25.0/act_100000000000001')
		expect(request.searchParams.get('fields')).toBe(fields)
		expect(request.searchParams.get('access_token')).toBe('access token')
	})

	it('paginates hierarchy through Meta-owned cursors and never double-prefixes account IDs', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: [
							{ id: 'campaign-1', name: 'Campaign 1', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS' },
						],
						paging: { next: 'https://graph.facebook.com/v25.0/act_100000000000001/campaigns?after=page-2' },
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: [{ id: 'campaign-2', name: 'Campaign 2', effective_status: 'PAUSED', objective: null }],
					}),
					{ status: 200 },
				),
			)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.listCampaigns('act_100000000000001')).resolves.toMatchObject({
			items: [
				{ id: 'campaign-1', effectiveStatus: 'ACTIVE', objective: 'OUTCOME_LEADS' },
				{ id: 'campaign-2', effectiveStatus: 'PAUSED', objective: null },
			],
		})

		const [firstUrl] = fetch.mock.calls[0] as [string]
		expect(new URL(firstUrl).pathname).toBe('/v25.0/act_100000000000001/campaigns')
		expect(new URL(firstUrl).searchParams.get('fields')).toBe('id,name,effective_status,objective')
	})

	it('rejects an untrusted pagination cursor before requesting it', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [{ id: 'campaign-1', name: 'Campaign 1', effective_status: 'ACTIVE', objective: null }],
					paging: { next: 'https://example.invalid/steal-token' },
				}),
				{ status: 200 },
			),
		)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.listCampaigns('100000000000001')).rejects.toThrow('untrusted host')
		expect(fetch).toHaveBeenCalledOnce()
	})

	it('normalizes daily insight action arrays and exposes throttle observations', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [
						{
							ad_id: 'ad-1',
							date_start: '2026-07-01',
							spend: '10.10',
							impressions: '101',
							inline_link_clicks: '7',
							actions: [{ action_type: 'lead', value: '2' }],
							action_values: [{ action_type: 'purchase', value: '20.20' }],
						},
					],
				}),
				{ status: 200, headers: { 'x-app-usage': '{"call_count":100}' } },
			),
		)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(
			client.listDailyInsights('100000000000001', { start: '2026-07-01', end: '2026-07-01' }),
		).resolves.toMatchObject({
			items: [{ adId: 'ad-1', date: '2026-07-01', impressions: 101, inlineLinkClicks: 7 }],
			throttle: { exhausted: true, app: { callCount: 100 } },
		})
	})

	it('requests identifiers needed for existing-post creative fallback', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: 'ad-1',
					creative: {
						id: 'creative-1',
						name: 'Existing post',
						effective_object_story_id: 'page_1_2',
						effective_instagram_media_id: 'ig_3',
					},
				}),
				{ status: 200 },
			),
		)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.getCreative('ad-1')).resolves.toMatchObject({
			id: 'creative-1',
			payload: { effective_object_story_id: 'page_1_2', effective_instagram_media_id: 'ig_3' },
		})
		const [url] = fetch.mock.calls[0] as [string]
		expect(new URL(url).searchParams.get('fields')).toBe(
			'creative{id,name,object_story_spec,asset_feed_spec,effective_object_story_id,effective_instagram_media_id,thumbnail_url,image_url,video_id,object_url}',
		)
	})

	it('retries a Meta rate limit exactly twice with exponential delays and retains usage headers', async () => {
		const fetch = vi.fn().mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: { message: 'Too many calls', type: 'OAuthException', code: 4, fbtrace_id: 'trace' },
					}),
					{
						status: 400,
						headers: { 'X-App-Usage': '{"call_count":100,"total_cputime":100,"total_time":100}' },
					},
				),
			),
		)
		const sleep = vi.fn().mockResolvedValue(undefined)
		const client = new MetaClient({ accessToken: 'token', fetch, sleep })

		await expect(client.getAccount('100000000000005')).rejects.toMatchObject({
			code: 4,
			appUsage: { callCount: 100, totalCpuTime: 100, totalTime: 100 },
		})
		expect(fetch).toHaveBeenCalledTimes(3)
		expect(sleep).toHaveBeenNthCalledWith(1, 1000)
		expect(sleep).toHaveBeenNthCalledWith(2, 2000)
	})

	it('does not retry permission revocation errors', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ error: { message: 'Permission denied', type: 'OAuthException', code: 10 } }),
					{ status: 400 },
				),
			)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.getAccount('100000000000006')).rejects.toBeInstanceOf(MetaApiError)
		expect(fetch).toHaveBeenCalledOnce()
	})
})
