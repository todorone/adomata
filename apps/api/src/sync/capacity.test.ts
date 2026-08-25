import { describe, expect, it } from 'vitest'

import { priorityForSyncWork, runWithMetaCapacity } from './capacity'

describe('Meta capacity', () => {
	it('runs queued work in the accepted priority order', async () => {
		const started: string[] = []
		let releaseRoutine: (() => void) | undefined
		const routine = runWithMetaCapacity(
			'routine',
			() =>
				new Promise<void>(resolve => {
					started.push('routine')
					releaseRoutine = resolve
				}),
		)
		const initialImport = runWithMetaCapacity('initial_import', async () => started.push('initial import'))
		const forceRefresh = runWithMetaCapacity('force_refresh', async () => started.push('Force Refresh'))

		releaseRoutine?.()
		await Promise.all([routine, initialImport, forceRefresh])

		expect(started).toEqual(['routine', 'Force Refresh', 'initial import'])
	})

	it('maps sync work to its accepted priority', () => {
		expect(priorityForSyncWork('connect', 'insights', 'connected')).toBe('routine')
		expect(priorityForSyncWork('cron', 'insights', 'pending')).toBe('initial_import')
		expect(priorityForSyncWork('manual', 'account_data')).toBe('force_refresh')
		expect(priorityForSyncWork('connect', 'hierarchy', 'pending')).toBe('initial_import')
		expect(priorityForSyncWork('cron', 'historical_reconciliation')).toBe('historical_reconciliation')
		expect(priorityForSyncWork('cron', 'creative', 'connected')).toBe('creative')
	})
})
