import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaClient } from '../meta/client'

const runtime = vi.hoisted(() => {
	let dependencies: { schedulerSecret: string; metaMode: 'fake' | 'live'; buildMetaClient: () => unknown } | undefined
	return {
		triggerBackgroundSync: vi.fn(),
		configureScheduler: vi.fn((value: typeof dependencies) => {
			dependencies = value
		}),
		getSchedulerDependencies: vi.fn(() => {
			if (!dependencies) throw new Error('Scheduler dependencies have not been configured')
			return dependencies
		}),
	}
})

vi.mock('../sync/runtime', () => runtime)

const { schedulerRoutes } = await import('./scheduler')
const { configureScheduler } = await import('../sync/runtime')

describe('POST /scheduler', () => {
	beforeEach(() => {
		runtime.triggerBackgroundSync.mockReset()
		configureScheduler({
			schedulerSecret: 'scheduler-secret',
			metaMode: 'fake',
			buildMetaClient: () => new MetaClient({ accessToken: 'test-token' }),
		})
	})

	it('rejects missing and invalid bearer credentials', async () => {
		await expect(schedulerRoutes.request('/', { method: 'POST' })).resolves.toMatchObject({ status: 401 })
		await expect(
			schedulerRoutes.request('/', { method: 'POST', headers: { Authorization: 'Bearer wrong-secret' } }),
		).resolves.toMatchObject({ status: 401 })
		expect(runtime.triggerBackgroundSync).not.toHaveBeenCalled()
	})

	it('accepts valid credentials and wakes routine work without waiting for it', async () => {
		const response = await schedulerRoutes.request('/', {
			method: 'POST',
			headers: { Authorization: 'Bearer scheduler-secret' },
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true, started: true })
		expect(runtime.triggerBackgroundSync).toHaveBeenCalledOnce()
	})
})
