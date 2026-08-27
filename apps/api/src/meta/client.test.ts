import { describe, expect, it, vi } from 'vitest'

import { isMetaRateLimit, MetaApiError, MetaClient } from './client'

const fields =
	'id,name,currency,timezone_name,account_status,disable_reason,balance,is_prepay_account,funding_source_details'
const prepayFields = 'id,name,currency,timezone_name,account_status,disable_reason,balance,is_prepay_account'
const fallbackFields = 'id,name,currency,timezone_name,account_status,disable_reason,balance'

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

	it('retries without funding-source details after a permission denial', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ error: { message: 'Permission denied', type: 'OAuthException', code: 10 } }),
					{ status: 400 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: '100000000000001',
						name: 'Reporting-only account',
						currency: 'USD',
						account_status: 1,
						disable_reason: 0,
						balance: '0',
						is_prepay_account: true,
						timezone_name: 'Europe/Kyiv',
					}),
					{ status: 200 },
				),
			)
		const client = new MetaClient({ accessToken: 'access token', fetch })

		await expect(client.getAccount('100000000000001')).resolves.toMatchObject({
			isPrepayAccount: true,
			fundingSourceType: null,
		})

		expect(new URL(fetch.mock.calls[0][0]).searchParams.get('fields')).toBe(fields)
		expect(new URL(fetch.mock.calls[1][0]).searchParams.get('fields')).toBe(prepayFields)
	})

	it('does not fall back to narrower Account fields after an exhausted throttle observation', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ error: { message: 'Permission denied', type: 'OAuthException', code: 10 } }),
					{ status: 400, headers: { 'X-App-Usage': '{"call_count":100}' } },
				),
			)
		const client = new MetaClient({ accessToken: 'access token', fetch })

		await expect(client.getAccount('100000000000001')).rejects.toMatchObject({ code: 10 })
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('keeps app and Ad Account throttle budgets scoped', async () => {
		const account = {
			id: '100000000000001',
			name: 'Funded prepay',
			currency: 'USD',
			account_status: 1,
			disable_reason: 0,
			balance: '0',
			is_prepay_account: true,
			timezone_name: 'Europe/Kyiv',
		}
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify(account), {
					status: 200,
					headers: { 'X-Ad-Account-Usage': '{"call_count":95,"estimated_time_to_regain_access":12}' },
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify(account), { status: 200, headers: { 'X-App-Usage': '{"call_count":95}' } }),
			)
		const client = new MetaClient({ accessToken: 'access token', fetch })

		await expect(client.getAccount('100000000000001')).resolves.toMatchObject({
			throttle: { appExhausted: false, accountExhausted: true },
		})
		await expect(client.getAccount('100000000000001')).resolves.toMatchObject({
			throttle: { appExhausted: true, accountExhausted: false },
		})
	})

	it('treats Meta code 17 as a retryable rate limit', async () => {
		const fetch = vi.fn().mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: { message: 'User request limit reached', type: 'OAuthException', code: 17 },
					}),
					{ status: 400 },
				),
			),
		)
		const sleep = vi.fn().mockResolvedValue(undefined)
		const client = new MetaClient({ accessToken: 'access token', fetch, sleep })

		await expect(client.getAccount('100000000000001')).rejects.toMatchObject({ code: 17 })
		expect(fetch).toHaveBeenCalledTimes(3)
		expect(isMetaRateLimit(new MetaApiError('User request limit reached', 400, 17))).toBe(true)
	})

	it('falls back to baseline fields when the prepay flag is also unavailable', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ error: { message: 'Permission denied', type: 'OAuthException', code: 10 } }),
					{ status: 400 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ error: { message: 'Permission denied', type: 'OAuthException', code: 10 } }),
					{ status: 400 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: '100000000000001',
						name: 'Analyze-only account',
						currency: 'USD',
						account_status: 1,
						disable_reason: 0,
						balance: '0',
						timezone_name: 'Europe/Kyiv',
					}),
					{ status: 200 },
				),
			)
		const client = new MetaClient({ accessToken: 'access token', fetch })

		await expect(client.getAccount('100000000000001')).resolves.toMatchObject({
			isPrepayAccount: null,
			fundingSourceType: null,
		})

		expect(new URL(fetch.mock.calls[2][0]).searchParams.get('fields')).toBe(fallbackFields)
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
						data: [{ id: 'campaign-2', name: 'Campaign 2', effective_status: 'FUTURE_STATUS', objective: null }],
					}),
					{ status: 200 },
				),
			)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.listCampaigns('act_100000000000001')).resolves.toMatchObject({
			items: [
				{ id: 'campaign-1', effectiveStatus: 'ACTIVE', objective: 'OUTCOME_LEADS' },
				{ id: 'campaign-2', effectiveStatus: 'FUTURE_STATUS', objective: null },
			],
		})

		const [firstUrl] = fetch.mock.calls[0] as [string]
		expect(new URL(firstUrl).pathname).toBe('/v25.0/act_100000000000001/campaigns')
		expect(new URL(firstUrl).searchParams.get('fields')).toBe('id,name,effective_status,objective')
		expect(new URL(firstUrl).searchParams.has('effective_status')).toBe(false)
	})

	it('stops pagination once Meta reports an exhausted budget', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [{ id: 'campaign-1', name: 'Campaign 1', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS' }],
					paging: { next: 'https://graph.facebook.com/v25.0/act_100000000000001/campaigns?after=page-2' },
				}),
				{ status: 200, headers: { 'X-App-Usage': '{"call_count":95}' } },
			),
		)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.listCampaigns('100000000000001')).resolves.toMatchObject({
			items: [{ id: 'campaign-1' }],
			complete: false,
			throttle: { appExhausted: true },
		})
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it('lists Ad Accounts and normalizes missing timezones to null', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: [
							{
								id: 'act_100000000000001',
								name: 'Funded prepay',
								currency: 'USD',
								timezone_name: 'Europe/Kyiv',
								business: { id: 'biz_1', name: 'Northstar Holdings' },
							},
						],
						paging: { next: 'https://graph.facebook.com/v25.0/me/adaccounts?after=page-2' },
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ data: [{ id: '100000000000002', name: 'No timezone yet', currency: 'USD' }] }),
					{ status: 200 },
				),
			)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.listAdAccounts()).resolves.toMatchObject({
			items: [
				{
					id: 'act_100000000000001',
					name: 'Funded prepay',
					currency: 'USD',
					timezoneName: 'Europe/Kyiv',
					businessId: 'biz_1',
					businessName: 'Northstar Holdings',
				},
				{
					id: 'act_100000000000002',
					name: 'No timezone yet',
					currency: 'USD',
					timezoneName: null,
					businessId: null,
					businessName: null,
				},
			],
		})

		const [firstUrl] = fetch.mock.calls[0] as [string]
		expect(new URL(firstUrl).pathname).toBe('/v25.0/me/adaccounts')
		expect(new URL(firstUrl).searchParams.get('fields')).toBe('id,name,currency,timezone_name,business{id,name}')
	})

	it('resolves Quality Leads ad sets to the lead result action type', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [
						{
							id: 'adset-1',
							campaign_id: 'campaign-1',
							name: 'Украина',
							effective_status: 'ACTIVE',
							optimization_goal: 'QUALITY_LEAD',
							promoted_object: null,
						},
					],
				}),
				{ status: 200 },
			),
		)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.listAdSets('act_100000000000001')).resolves.toMatchObject({
			items: [{ id: 'adset-1', optimizationGoal: 'QUALITY_LEAD', resultActionType: 'lead' }],
		})
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
				{ status: 200, headers: { 'x-app-usage': '{"call_count":95}' } },
			),
		)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(
			client.listDailyInsights('100000000000001', { start: '2026-07-01', end: '2026-07-01' }),
		).resolves.toMatchObject({
			items: [{ adId: 'ad-1', date: '2026-07-01', impressions: 101, inlineLinkClicks: 7 }],
			throttle: { appExhausted: true, app: { callCount: 95 } },
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

	it('returns throttle observations from Creative requests', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: 'ad-1', creative: { id: 'creative-1' } }), {
				status: 200,
				headers: { 'X-App-Usage': '{"call_count":95}' },
			}),
		)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.getCreative('ad-1')).resolves.toMatchObject({ throttle: { appExhausted: true } })
	})

	it('stores a streamable source for video creatives', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: 'ad-1', creative: { id: 'creative-1', video_id: '1001' } }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ source: 'https://media.example.test/1001.mp4' }), { status: 200 }),
			)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.getCreative('ad-1')).resolves.toMatchObject({
			payload: { video_id: '1001', video_url: 'https://media.example.test/1001.mp4' },
		})
		expect(new URL(fetch.mock.calls[1]![0]).searchParams.get('fields')).toBe('source')
	})

	it('stores streamable sources for asset-feed videos', async () => {
		const fetch = vi.fn(async (input: string) => {
			const id = new URL(input).pathname.split('/').at(-1)
			if (id === 'ad-1') {
				return new Response(
					JSON.stringify({
						id: 'ad-1',
						creative: { id: 'creative-1', asset_feed_spec: { videos: [{ video_id: '1001' }] } },
					}),
					{ status: 200 },
				)
			}
			return new Response(JSON.stringify({ source: 'https://media.example.test/1001.mp4' }), { status: 200 })
		})
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.getCreative('ad-1')).resolves.toMatchObject({
			payload: {
				asset_feed_spec: { videos: [{ video_id: '1001', video_url: 'https://media.example.test/1001.mp4' }] },
			},
		})
	})

	it('resolves asset-feed image hashes through the ad account image library', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						id: 'ad-1',
						creative: {
							id: 'creative-1',
							asset_feed_spec: { images: [{ hash: 'image-1' }, { hash: 'image-2' }] },
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: [
							{ hash: 'image-1', url: 'https://media.example.test/image-1.jpg' },
							{ hash: 'image-2', url: 'https://media.example.test/image-2.jpg' },
						],
					}),
					{ status: 200 },
				),
			)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.getCreative('ad-1', 'act_123')).resolves.toMatchObject({
			payload: {
				asset_feed_spec: {
					images: [
						{ hash: 'image-1', url: 'https://media.example.test/image-1.jpg' },
						{ hash: 'image-2', url: 'https://media.example.test/image-2.jpg' },
					],
				},
			},
		})
		const [url] = fetch.mock.calls[1] as [string]
		expect(new URL(url).pathname).toBe('/v25.0/act_123/adimages')
		expect(new URL(url).searchParams.get('fields')).toBe('hash,url')
		expect(new URL(url).searchParams.get('hashes')).toBe(JSON.stringify(['image-1', 'image-2']))
	})

	it('does not request a video source for malformed asset-feed IDs', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: 'ad-1',
					creative: { id: 'creative-1', asset_feed_spec: { videos: [{ video_id: '1001?fields=id' }] } },
				}),
				{ status: 200 },
			),
		)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.getCreative('ad-1')).resolves.toMatchObject({
			payload: { asset_feed_spec: { videos: [{ video_id: '1001?fields=id' }] } },
		})
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it("walks past placements the Ad cannot render and returns the hosted preview at Meta's own size", async () => {
		const fetch = vi.fn().mockImplementation((url: string) =>
			Promise.resolve(
				new URL(url).searchParams.get('ad_format') === 'INSTAGRAM_STANDARD'
					? new Response(
							JSON.stringify({
								data: [
									{
										body: '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=ad-1&amp;t=token" width="320" height="600"></iframe>',
									},
								],
							}),
							{ status: 200 },
						)
					: new Response(JSON.stringify({ error: { message: 'Unsupported ad_format', code: 100 } }), {
							status: 400,
						}),
			),
		)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.getAdPreview('ad-1')).resolves.toEqual({
			url: 'https://www.facebook.com/ads/api/preview_iframe.php?d=ad-1&t=token',
			width: 320,
			height: 600,
		})

		const formats = fetch.mock.calls.map(call => new URL(call[0] as string).searchParams.get('ad_format'))
		expect(formats).toEqual(['MOBILE_FEED_STANDARD', 'INSTAGRAM_STANDARD'])
		expect(new URL(fetch.mock.calls[0]![0] as string).pathname).toBe('/v25.0/ad-1/previews')
	})

	it('refuses a preview iframe that does not point at Meta, and reports no preview when no placement renders', async () => {
		const offSite = vi.fn().mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						data: [{ body: '<iframe src="https://evil.test/preview_iframe.php" width="320"></iframe>' }],
					}),
					{ status: 200 },
				),
			),
		)
		await expect(new MetaClient({ accessToken: 'token', fetch: offSite }).getAdPreview('ad-1')).resolves.toBeNull()

		const rejected = vi
			.fn()
			.mockImplementation(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { message: 'Unsupported', code: 100 } }), { status: 400 }),
				),
			)
		await expect(new MetaClient({ accessToken: 'token', fetch: rejected }).getAdPreview('ad-1')).resolves.toBeNull()
	})

	it('aborts the preview probe on a throttle instead of spending every placement on it', async () => {
		const fetch = vi
			.fn()
			.mockImplementation(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { message: 'Too many calls', code: 4 } }), { status: 400 }),
				),
			)
		const sleep = vi.fn().mockResolvedValue(undefined)

		await expect(new MetaClient({ accessToken: 'token', fetch, sleep }).getAdPreview('ad-1')).rejects.toMatchObject({
			code: 4,
		})
		// Three retries of the first placement, not three of each of the four.
		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it('stops retrying once Meta reports an exhausted budget and retains usage headers', async () => {
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
		const client = new MetaClient({ accessToken: 'token', fetch, sleep, random: () => 0.5 })

		await expect(client.getAccount('100000000000005')).rejects.toMatchObject({
			code: 4,
			appUsage: { callCount: 100, totalCpuTime: 100, totalTime: 100 },
		})
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(sleep).not.toHaveBeenCalled()
	})

	it('retries transient Meta failures with bounded exponential jitter', async () => {
		const fetch = vi.fn().mockImplementation(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: { message: 'upstream failure', type: 'OAuthException', code: 1 } }), {
					status: 500,
				}),
			),
		)
		const sleep = vi.fn().mockResolvedValue(undefined)
		const client = new MetaClient({ accessToken: 'token', fetch, sleep, random: () => 0.5 })

		await expect(client.getAccount('100000000000005')).rejects.toMatchObject({ status: 500, code: 1 })
		expect(fetch).toHaveBeenCalledTimes(3)
		expect(sleep).toHaveBeenNthCalledWith(1, 1500)
		expect(sleep).toHaveBeenNthCalledWith(2, 3000)
	})

	it('verifies a token against GET /me', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ id: 'user-1', name: 'Test User' }), { status: 200 }))
		const client = new MetaClient({ accessToken: 'access token', fetch })

		await expect(client.verifyToken()).resolves.toEqual({ id: 'user-1', name: 'Test User' })

		const [url] = fetch.mock.calls[0] as [string]
		const request = new URL(url)
		expect(request.origin + request.pathname).toBe('https://graph.facebook.com/v25.0/me')
		expect(request.searchParams.get('fields')).toBe('id,name')
		expect(request.searchParams.get('access_token')).toBe('access token')
	})

	it('rejects verifyToken with a MetaApiError for an invalid token', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } }),
				{
					status: 401,
				},
			),
		)
		const client = new MetaClient({ accessToken: 'bad token', fetch })

		await expect(client.verifyToken()).rejects.toMatchObject({ code: 190, message: 'Invalid OAuth access token' })
	})

	it('tries the lower-privilege read once before reporting a permission revocation', async () => {
		const fetch = vi
			.fn()
			.mockImplementation(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({ error: { message: 'Permission denied', type: 'OAuthException', code: 10 } }),
						{ status: 400 },
					),
				),
			)
		const client = new MetaClient({ accessToken: 'token', fetch })

		await expect(client.getAccount('100000000000006')).rejects.toBeInstanceOf(MetaApiError)
		expect(fetch).toHaveBeenCalledTimes(3)
		expect(new URL(fetch.mock.calls[2][0]).searchParams.get('fields')).toBe(fallbackFields)
	})
})
