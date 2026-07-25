import { z } from 'zod'
import { apiErrorSchema, ApiClientError } from '@adomata/api/client'

type JsonResponse = {
	ok: boolean
	status: number
	json: () => Promise<unknown>
}

function reportSchemaMismatch(message: string, extra: Record<string, unknown>) {
	console.error(message, extra)
}

export async function parseResponse<T>(
	res: JsonResponse,
	schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: z.ZodError } },
	route: string,
): Promise<T> {
	const body = await res.json().catch(() => null)
	if (!res.ok) {
		const parsed = apiErrorSchema.safeParse(body)
		if (!parsed.success) {
			reportSchemaMismatch('apiError envelope mismatch', { route, status: res.status, body })
			throw new ApiClientError(
				{ error: { code: 'INTERNAL', message: `Unexpected error shape (${res.status})` } },
				res.status,
			)
		}
		throw new ApiClientError(parsed.data, res.status)
	}

	const parsed = schema.safeParse(body)
	if (!parsed.success) {
		reportSchemaMismatch('Response schema mismatch', { route, status: res.status, issues: parsed.error.issues })
		throw new ApiClientError(
			{ error: { code: 'INTERNAL', message: 'Server returned an unexpected response shape.' } },
			res.status,
		)
	}
	return parsed.data
}

export async function parseNoContent(res: JsonResponse, route: string): Promise<void> {
	if (res.status === 204) return
	await parseResponse(res, z.never(), route)
}
