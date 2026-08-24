type SchedulerEnvironment = {
	API_URL: string
	HEARTBEAT_SECRET: string
}

const worker = {
	async scheduled(_controller: unknown, environment: SchedulerEnvironment) {
		const response = await fetch(new URL('/heartbeat', environment.API_URL), {
			method: 'POST',
			headers: { Authorization: `Bearer ${environment.HEARTBEAT_SECRET}` },
		})
		if (!response.ok) throw new Error(`Heartbeat scheduler request failed with status ${response.status}`)
	},
}

export default worker
