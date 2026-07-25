import * as React from 'react'
import { Building2, LayoutDashboard, Users, UsersRound } from 'lucide-react'

import { NavMain } from '@/components/nav-main'
import { NavUser } from '@/components/nav-user'
import { TeamSwitcher } from '@/components/team-switcher'
import { useMe } from '@/data/me'
import { useSession } from '@/data/session'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/ui/sidebar'

const navMain = [
	{
		title: 'Dashboard',
		url: '/',
		icon: LayoutDashboard,
		isActive: true,
		items: [{ title: 'Overview', url: '/' }],
	},
	{
		title: 'Users',
		url: '/users/invites',
		icon: Users,
		items: [{ title: 'Invites', url: '/users/invites' }],
	},
]

const superadminNav = [
	{
		title: 'Agencies',
		url: '/super/agencies',
		icon: Building2,
	},
	{
		title: 'Users',
		url: '/super/users',
		icon: UsersRound,
	},
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { data: session } = useSession()

	const user = {
		name: session?.data?.user.name ?? 'User',
		email: session?.data?.user.email ?? '',
		avatar: session?.data?.user.image ?? undefined,
	}

	const superadminEmail = import.meta.env.VITE_SUPERADMIN_EMAIL as string | undefined
	const isSuperadmin = superadminEmail && session?.data?.user.email.toLowerCase() === superadminEmail.toLowerCase()
	const shouldFetchOrganization = Boolean(session?.data && !isSuperadmin)
	const { data: me } = useMe(shouldFetchOrganization)
	const organization = me?.activeOrganization

	return (
		<Sidebar collapsible="icon" {...props}>
			{organization && (
				<SidebarHeader>
					<TeamSwitcher teams={[{ name: organization.name, logo: Building2, plan: 'Agency' }]} />
				</SidebarHeader>
			)}
			<SidebarContent>
				<NavMain items={navMain} />
				{isSuperadmin && <NavMain items={superadminNav} />}
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	)
}
