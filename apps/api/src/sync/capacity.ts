type MetaWorkPriority = 'routine' | 'force_refresh' | 'initial_import' | 'historical_reconciliation' | 'creative'

const priorityOrder: Record<MetaWorkPriority, number> = {
	routine: 0,
	force_refresh: 1,
	initial_import: 2,
	historical_reconciliation: 3,
	creative: 4,
}

let active = false
let sequence = 0
const waiting: Array<{
	priority: MetaWorkPriority
	sequence: number
	run: () => void
}> = []

export function priorityForSyncWork(
	trigger: 'cron' | 'connect' | 'manual',
	slice: 'account_data' | 'hierarchy' | 'insights' | 'creative' | 'historical_reconciliation',
	connectionStatus?: 'pending' | 'connected' | 'access_lost',
): MetaWorkPriority {
	if (slice === 'historical_reconciliation') return 'historical_reconciliation'
	if (slice === 'creative') return 'creative'
	if (trigger === 'manual') return 'force_refresh'
	return connectionStatus === 'connected' ? 'routine' : 'initial_import'
}

export function runWithMetaCapacity<T>(priority: MetaWorkPriority, task: () => Promise<T>) {
	return new Promise<T>((resolve, reject) => {
		waiting.push({
			priority,
			sequence: sequence++,
			run: () => {
				task().then(resolve, reject).finally(releaseMetaCapacity)
			},
		})
		drainMetaCapacity()
	})
}

function drainMetaCapacity() {
	if (active) return
	const next = waiting.sort(
		(left, right) => priorityOrder[left.priority] - priorityOrder[right.priority] || left.sequence - right.sequence,
	)[0]
	if (!next) return
	active = true
	waiting.splice(waiting.indexOf(next), 1)
	next.run()
}

function releaseMetaCapacity() {
	active = false
	drainMetaCapacity()
}
