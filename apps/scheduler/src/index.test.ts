import { afterEach, describe, expect, it, vi } from 'vitest'

import worker from './index'

const environment = {
	API_URL: 'https://api.example.com',
	SCHEDULER_SECRET: 'scheduler-secret',
}

describe('scheduled Worker handler', () => {
	afterEach(() => vi.unstubAllGlobals())

	it('authenticates its scheduler request to the API scheduler endpoint', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
		vi.stubGlobal('fetch', fetch)

		await worker.scheduled(undefined, environment)

		expect(fetch).toHaveBeenCalledWith(new URL('/scheduler', environment.API_URL), {
			method: 'POST',
			headers: { Authorization: 'Bearer scheduler-secret' },
		})
	})

	it('fails the invocation when the API rejects scheduling', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))

		await expect(worker.scheduled(undefined, environment)).rejects.toThrow('Scheduler request failed with status 503')
	})
})
