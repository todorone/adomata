import { z } from 'zod'

export const apiErrorCodeEnum = z.enum([
	'BAD_REQUEST',
	'UNAUTHORIZED',
	'FORBIDDEN',
	'NOT_FOUND',
	'CONFLICT',
	'INTERNAL',
	'SERVICE_UNAVAILABLE',
	'NO_ACTIVE_ORGANIZATION',
])
export type ApiErrorCode = z.infer<typeof apiErrorCodeEnum>

export const apiErrorSchema = z.object({
	error: z.object({
		code: apiErrorCodeEnum,
		message: z.string(),
		details: z.unknown().optional(),
	}),
})
export type ApiErrorBody = z.infer<typeof apiErrorSchema>

export class ApiClientError extends Error {
	readonly code: ApiErrorCode
	readonly status: number
	readonly details: unknown

	constructor(body: ApiErrorBody, status: number) {
		super(body.error.message)
		this.name = 'ApiClientError'
		this.code = body.error.code
		this.status = status
		this.details = body.error.details
	}
}
