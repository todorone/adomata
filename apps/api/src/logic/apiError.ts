import type { Context } from 'hono'

import type { ApiErrorCode } from '../client/error'

const defaultStatusFor: Record<ApiErrorCode, 400 | 401 | 403 | 404 | 409 | 500 | 503> = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	INTERNAL: 500,
	SERVICE_UNAVAILABLE: 503,
	NO_ACTIVE_ORGANIZATION: 403,
}

export function apiError(
	c: Context,
	code: ApiErrorCode,
	options: { status?: 400 | 401 | 403 | 404 | 409 | 500 | 503; message?: string; details?: unknown } = {},
) {
	const status = options.status ?? defaultStatusFor[code]
	return c.json({ error: { code, message: options.message ?? code, details: options.details } }, status)
}
