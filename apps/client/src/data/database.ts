import { useMutation } from '@tanstack/react-query'

import { api } from './core/apiClient'
import { parseNoContent } from './core/apiFetch'
import { queryClient } from './core/queryClient'

// The wipe removes the caller's user and session, so cached authenticated data
// must not survive the redirect to login.
export function useWipeDatabase() {
	return useMutation({
		mutationFn: async () => parseNoContent(await api.admin.database.$delete(), 'DELETE /admin/database'),
		onSuccess: () => queryClient.clear(),
	})
}
