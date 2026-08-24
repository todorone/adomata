import { z } from 'zod'

export const forceRefreshResponseSchema = z.object({
	id: z.string(),
	status: z.enum(['queued', 'running', 'completed', 'failed']),
})
export type ForceRefreshResponse = z.infer<typeof forceRefreshResponseSchema>
