import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { ErrorFallback } from '@/components/error-fallback'
import { routeTree } from './routeTree.gen'

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: false,
		defaultErrorComponent: ({ error, reset }) => <ErrorFallback error={error} reset={reset} />,
	})

	return router
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
