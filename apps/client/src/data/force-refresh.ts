import { forceRefreshResponseSchema } from '@adomata/api/client'

import { api } from './core/apiClient'
import { parseResponse } from './core/apiFetch'

export async function requestForceRefresh() {
	return parseResponse(await api['force-refresh'].$post(), forceRefreshResponseSchema, 'POST /force-refresh')
}

export async function readForceRefresh(forceRefreshId: string, signal?: AbortSignal) {
	return parseResponse(
		await api['force-refresh'][':forceRefreshId'].$get({ param: { forceRefreshId } }, { init: { signal } }),
		forceRefreshResponseSchema,
		'GET /force-refresh/:forceRefreshId',
	)
}
