type MetaWorkPriority = 'routine' | 'force_refresh' | 'initial_import' | 'historical_reconciliation' | 'creative'

const priorityOrder: Record<MetaWorkPriority, number> = {
	routine: 0,
	force_refresh: 1,
	initial_import: 2,
	historical_reconciliation: 3,
	creative: 4,
}

// Meta does not publish a fixed app-wide Insights QPS ceiling. Ten slots is a bounded starting point
// for the researched 300–750-call, five-minute refresh target; response-header throttles remain the
// authoritative backpressure when the app's actual budget is lower.
export const metaCapacityConcurrency = 10

let activeMetaOperations = 0
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

export function runWithMetaCapacity<T>(priority: MetaWorkPriority, task: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		waiting.push({
			priority,
			sequence: sequence++,
			run: () => {
				Promise.resolve().then(task).then(resolve, reject).finally(releaseMetaCapacity)
			},
		})
		drainMetaCapacity()
	})
}

function drainMetaCapacity() {
	while (activeMetaOperations < metaCapacityConcurrency) {
		const next = waiting.sort(
			(left, right) =>
				priorityOrder[left.priority] - priorityOrder[right.priority] || left.sequence - right.sequence,
		)[0]
		if (!next) return
		activeMetaOperations += 1
		waiting.splice(waiting.indexOf(next), 1)
		next.run()
	}
}

function releaseMetaCapacity() {
	activeMetaOperations -= 1
	drainMetaCapacity()
}
