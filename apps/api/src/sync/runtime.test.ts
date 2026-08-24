import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MetaClient } from '../meta/client'

const sync = vi.hoisted(() => ({
	runHeartbeat: vi.fn(),
	scheduleAccountDataRun: vi.fn(),
	scheduleHierarchyRun: vi.fn(),
}))

vi.mock('./account-tier', () => ({ runHeartbeat: sync.runHeartbeat }))
vi.mock('./account-data', () => ({ scheduleAccountDataRun: sync.scheduleAccountDataRun }))
vi.mock('./hierarchy', () => ({ scheduleHierarchyRun: sync.scheduleHierarchyRun }))

const { configureHeartbeat, triggerBackgroundSync } = await import('./runtime')

describe('triggerBackgroundSync', () => {
	beforeEach(() => {
		sync.runHeartbeat.mockReset()
		sync.scheduleAccountDataRun.mockReset()
		sync.scheduleHierarchyRun.mockReset()
	})

	it('does nothing when heartbeat dependencies are not configured', () => {
		expect(() => triggerBackgroundSync()).not.toThrow()
		expect(sync.runHeartbeat).not.toHaveBeenCalled()
	})

	it('fires a heartbeat immediately without waiting for it to resolve', async () => {
		let resolveHeartbeat: (() => void) | undefined
		sync.runHeartbeat.mockReturnValue(
			new Promise<void>(resolve => {
				resolveHeartbeat = resolve
			}),
		)
		const buildMetaClient = () => new MetaClient({ accessToken: 'test-token' })
		configureHeartbeat({ heartbeatSecret: 'secret', metaMode: 'fake', buildMetaClient })

		triggerBackgroundSync()

		expect(sync.runHeartbeat).toHaveBeenCalledWith({ metaMode: 'fake', buildMetaClient })
		resolveHeartbeat?.()
	})

	it('swallows a rejected heartbeat instead of throwing', async () => {
		sync.runHeartbeat.mockRejectedValue(new Error('boom'))
		configureHeartbeat({
			heartbeatSecret: 'secret',
			metaMode: 'fake',
			buildMetaClient: () => new MetaClient({ accessToken: 'test-token' }),
		})

		expect(() => triggerBackgroundSync()).not.toThrow()
		await new Promise(resolve => setTimeout(resolve, 0))
	})
})
