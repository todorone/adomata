import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

const DEFAULT_STALE_TIME = 10 * 60 * 1000
const DEFAULT_GC_TIME = 7 * 24 * 60 * 60 * 1000

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			staleTime: DEFAULT_STALE_TIME,
			gcTime: DEFAULT_GC_TIME,
			refetchOnWindowFocus: false,
		},
	},
	queryCache: new QueryCache({
		onError: error => {
			console.error(error)
		},
	}),
	mutationCache: new MutationCache({
		onError: error => {
			console.error(error)
		},
	}),
})
