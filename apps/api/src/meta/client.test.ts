import { describe, expect, it, vi } from 'vitest'

import { MetaApiError, MetaClient } from './client'

const fields = 'id,name,currency,account_status,disable_reason,balance,is_prepay_account,funding_source_details'

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
					funding_source_details: { type: 20 },
				}),
				{ status: 200 },
			),
		)
		const client = new MetaClient({ accessToken: 'access token', fetch })

		await expect(client.getAccount('100000000000001')).resolves.toEqual({
			id: '100000000000001',
			name: 'Funded prepay',
			currency: 'USD',
			metaAccountStatus: 1,
			metaDisableReason: 0,
			balance: '0',
			isPrepayAccount: true,
			fundingSourceType: 20,
		})

		const [url] = fetch.mock.calls[0] as [string]
		const request = new URL(url)
		expect(request.origin + request.pathname).toBe('https://graph.facebook.com/v25.0/act_100000000000001')
		expect(request.searchParams.get('fields')).toBe(fields)
		expect(request.searchParams.get('access_token')).toBe('access token')
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
