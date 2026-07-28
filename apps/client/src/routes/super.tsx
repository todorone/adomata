import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { meQueries } from '@/data/me'
import { requireSession } from '@/data/session'
import { queryClient } from '@/data/core/queryClient'

export const Route = createFileRoute('/super')({
	beforeLoad: async () => {
		await requireSession()
		const me = await queryClient.ensureQueryData(meQueries.current())
		if (!me.isSuperadmin) {
			throw redirect({ to: '/' })
		}
	},
	component: () => <Outlet />,
})
