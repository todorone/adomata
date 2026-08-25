import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaClient } from '../meta/client'

const runtime = vi.hoisted(() => {
	let dependencies: { heartbeatSecret: string; metaMode: 'fake' | 'live'; buildMetaClient: () => unknown } | undefined
	return {
		triggerBackgroundSync: vi.fn(),
		configureHeartbeat: vi.fn((value: typeof dependencies) => {
			dependencies = value
		}),
		getHeartbeatDependencies: vi.fn(() => {
			if (!dependencies) throw new Error('Heartbeat dependencies have not been configured')
			return dependencies
		}),
	}
})

vi.mock('../sync/runtime', () => runtime)

const { heartbeatRoutes } = await import('./heartbeat')
const { configureHeartbeat } = await import('../sync/runtime')

describe('POST /heartbeat', () => {
	beforeEach(() => {
		runtime.triggerBackgroundSync.mockReset()
		configureHeartbeat({
			heartbeatSecret: 'heartbeat-secret',
			metaMode: 'fake',
			buildMetaClient: () => new MetaClient({ accessToken: 'test-token' }),
		})
	})

	it('rejects missing and invalid bearer credentials', async () => {
		await expect(heartbeatRoutes.request('/', { method: 'POST' })).resolves.toMatchObject({ status: 401 })
		await expect(
			heartbeatRoutes.request('/', { method: 'POST', headers: { Authorization: 'Bearer wrong-secret' } }),
		).resolves.toMatchObject({ status: 401 })
		expect(runtime.triggerBackgroundSync).not.toHaveBeenCalled()
	})

	it('accepts valid credentials, confirms it started, and fires background sync without waiting on it', async () => {
		const response = await heartbeatRoutes.request('/', {
			method: 'POST',
			headers: { Authorization: 'Bearer heartbeat-secret' },
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true, started: true })
		expect(runtime.triggerBackgroundSync).toHaveBeenCalledOnce()
	})
})
