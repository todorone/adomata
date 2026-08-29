import { describe, expect, it } from 'vitest'

import { metaCapacityConcurrency, priorityForSyncWork, runWithMetaCapacity } from './capacity'

describe('Meta capacity', () => {
	it('admits the configured concurrent work and runs queued work in the accepted priority order', async () => {
		const started: string[] = []
		const releaseRoutines: Array<() => void> = []
		const routines = Array.from({ length: metaCapacityConcurrency }, (_, index) =>
			runWithMetaCapacity(
				'routine',
				() =>
					new Promise<void>(resolve => {
						started.push(`routine ${index + 1}`)
						releaseRoutines.push(resolve)
					}),
			),
		)

		await Promise.resolve()
		expect(started).toHaveLength(metaCapacityConcurrency)

		const initialImport = runWithMetaCapacity('initial_import', async () => started.push('initial import'))
		const forceRefresh = runWithMetaCapacity('force_refresh', async () => started.push('Force Refresh'))

		expect(started).toHaveLength(metaCapacityConcurrency)
		for (const releaseRoutine of releaseRoutines) releaseRoutine()
		await Promise.all([...routines, initialImport, forceRefresh])

		expect(started.slice(metaCapacityConcurrency)).toEqual(['Force Refresh', 'initial import'])
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
