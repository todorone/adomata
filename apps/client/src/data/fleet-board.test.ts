import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fleetBoardQueries } from './fleet-board'

const input = {
	range: 'last7' as const,
	search: '',
	needsAttention: false,
	sort: 'attention' as const,
	direction: 'desc' as const,
}

describe('Fleet Board snapshot query', () => {
	afterEach(() => vi.unstubAllGlobals())

	it('quietly polls the Postgres snapshot while visible without calling a Meta-triggering route', async () => {
		const fetch = vi.fn().mockImplementation(
			async () =>
				new Response(JSON.stringify({ clients: [], accounts: [], nodes: [], header: { provisional: false } }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}),
		)
		vi.stubGlobal('fetch', fetch)
		const query = fleetBoardQueries.root(input)

		expect(query.refetchInterval).toBe(60_000)
		expect(query.refetchIntervalInBackground).toBe(false)
		expect(query.refetchOnWindowFocus).toBe('always')

		const client = new QueryClient()
		await client.fetchQuery(query)
		await client.fetchQuery(query)

		for (const [request] of fetch.mock.calls) {
			expect(new URL(request as string).pathname).toBe('/fleet-board')
		}
	})
})
