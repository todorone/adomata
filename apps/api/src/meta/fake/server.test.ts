import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { fakeMetaAccounts } from './roster'
import { fakeMetaServer, rejectUnhandledMetaRequest } from './server'

describe('rejectUnhandledMetaRequest', () => {
	it('blocks every unhandled Meta host while leaving unrelated requests alone', () => {
		expect(() => rejectUnhandledMetaRequest(new Request('https://graph-video.facebook.com/v25.0/request'))).toThrow(
			'Blocked unhandled Meta request in fake mode',
		)
		expect(() => rejectUnhandledMetaRequest(new Request('https://example.com/request'))).not.toThrow()
	})
})

describe('GET /me/adaccounts', () => {
	beforeAll(() => fakeMetaServer.listen({ onUnhandledRequest: 'error' }))
	afterEach(() => fakeMetaServer.resetHandlers())
	afterAll(() => fakeMetaServer.close())

	it('serves the fixture roster, paginated', async () => {
		const items: unknown[] = []
		let url: string | undefined =
			'https://graph.facebook.com/v25.0/me/adaccounts?access_token=token&fields=id,name,currency,timezone_name'
		while (url) {
			const res = await fetch(url)
			expect(res.ok).toBe(true)
			const body = (await res.json()) as { data: unknown[]; paging?: { next?: string } }
			items.push(...body.data)
			url = body.paging?.next
		}

		expect(items).toEqual(
			fakeMetaAccounts.map(account => ({
				id: account.id,
				name: account.name,
				currency: account.currency,
				timezone_name: account.timezoneName,
			})),
		)
	})

	it('rejects a request missing the access token', async () => {
		const res = await fetch('https://graph.facebook.com/v25.0/me/adaccounts?fields=id,name,currency,timezone_name')
		expect(res.status).toBe(500)
		const body = (await res.json()) as { error: { message: string } }
		expect(body.error.message).toBe('Missing access token')
	})
})
