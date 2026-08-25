type SchedulerEnvironment = {
	API_URL: string
	SCHEDULER_SECRET: string
}

const worker = {
	async scheduled(_controller: unknown, environment: SchedulerEnvironment) {
		const response = await fetch(new URL('/scheduler', environment.API_URL), {
			method: 'POST',
			headers: { Authorization: `Bearer ${environment.SCHEDULER_SECRET}` },
		})
		if (!response.ok) throw new Error(`Scheduler request failed with status ${response.status}`)
	},
}

export default worker
