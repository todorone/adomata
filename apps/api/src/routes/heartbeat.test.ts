import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaClient } from '../meta/client'
import { configureHeartbeat } from '../sync/runtime'

const sync = vi.hoisted(() => ({ runHeartbeat: vi.fn() }))

vi.mock('../sync/account-tier', () => ({ runHeartbeat: sync.runHeartbeat }))

const { heartbeatRoutes } = await import('./heartbeat')

describe('POST /heartbeat', () => {
	beforeEach(() => {
		sync.runHeartbeat.mockReset()
		sync.runHeartbeat.mockResolvedValue({
			accountTier: { processed: 2, failed: 0, skipped: 0 },
			insightsTier: { processed: 1, failed: 0, skipped: 0 },
		})
		configureHeartbeat({
			metaClient: new MetaClient({ accessToken: 'test-token' }),
			heartbeatSecret: 'heartbeat-secret',
		})
	})

	it('rejects missing and invalid bearer credentials', async () => {
		await expect(heartbeatRoutes.request('/', { method: 'POST' })).resolves.toMatchObject({ status: 401 })
		await expect(
			heartbeatRoutes.request('/', { method: 'POST', headers: { Authorization: 'Bearer wrong-secret' } }),
		).resolves.toMatchObject({ status: 401 })
		expect(sync.runHeartbeat).not.toHaveBeenCalled()
	})

	it('runs the heartbeat with the configured Meta client for valid credentials', async () => {
		const response = await heartbeatRoutes.request('/', {
			method: 'POST',
			headers: { Authorization: 'Bearer heartbeat-secret' },
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			ok: true,
			accountTier: { processed: 2, failed: 0, skipped: 0 },
			insightsTier: { processed: 1, failed: 0, skipped: 0 },
		})
		expect(sync.runHeartbeat).toHaveBeenCalledOnce()
	})
})
