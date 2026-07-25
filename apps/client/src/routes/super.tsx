import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { requireSession } from '@/data/session'

export const Route = createFileRoute('/super')({
	beforeLoad: async () => {
		const session = await requireSession()
		const superadminEmail = import.meta.env.VITE_SUPERADMIN_EMAIL as string | undefined
		if (superadminEmail && session.user.email.toLowerCase() !== superadminEmail.toLowerCase()) {
			throw redirect({ to: '/' })
		}
	},
	component: () => <Outlet />,
})
