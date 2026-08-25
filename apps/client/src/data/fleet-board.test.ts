import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fleetBoardQueries, useFleetBoardRoot } from './fleet-board'

const input = {
	range: 'last7' as const,
	search: '',
	needsAttention: false,
	sort: 'attention' as const,
	direction: 'desc' as const,
}

describe('Fleet Board snapshot query', () => {
	afterEach(() => {
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it('quietly polls the Postgres snapshot while visible without calling a Meta-triggering route', async () => {
		vi.useFakeTimers()
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

		render(
			createElement(
				QueryClientProvider,
				{ client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
				createElement(SnapshotReader),
			),
		)
		await vi.advanceTimersByTimeAsync(0)
		expect(fetch).toHaveBeenCalledTimes(1)

		await vi.advanceTimersByTimeAsync(60_000)
		expect(fetch).toHaveBeenCalledTimes(2)

		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
		window.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(60_000)
		expect(fetch).toHaveBeenCalledTimes(2)

		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
		window.dispatchEvent(new Event('visibilitychange'))
		await vi.advanceTimersByTimeAsync(0)
		expect(fetch).toHaveBeenCalledTimes(3)

		for (const [request] of fetch.mock.calls) {
			expect(new URL(request as string).pathname).toBe('/fleet-board')
		}
	})
})

function SnapshotReader() {
	useFleetBoardRoot(input)
	return null
}
