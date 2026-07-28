import * as React from 'react'
import { Building2, Database, LayoutDashboard, Settings, Users, UsersRound } from 'lucide-react'

import { NavMain } from '@/components/nav-main'
import { NavUser } from '@/components/nav-user'
import { TeamSwitcher } from '@/components/team-switcher'
import { useMe } from '@/data/me'
import { useSession } from '@/data/session'
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@/ui/sidebar'

const navMain = [
	{
		title: 'Дашборд',
		url: '/',
		icon: LayoutDashboard,
		isActive: true,
		items: [{ title: 'Огляд', url: '/' }],
	},
	{
		title: 'Користувачі',
		url: '/users/invites',
		icon: Users,
		items: [{ title: 'Запрошення', url: '/users/invites' }],
	},
]

const ownerNav = [
	{
		title: 'Налаштування',
		url: '/organization/settings',
		icon: Settings,
	},
]

const superadminNav = [
	{
		title: 'Агенції',
		url: '/super/agencies',
		icon: Building2,
	},
	{
		title: 'Користувачі',
		url: '/super/users',
		icon: UsersRound,
	},
	{
		title: 'База даних',
		url: '/super/database',
		icon: Database,
	},
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const { data: session } = useSession()

	const user = {
		name: session?.data?.user.name ?? 'Користувач',
		email: session?.data?.user.email ?? '',
		avatar: session?.data?.user.image ?? undefined,
	}

	const superadminEmail = import.meta.env.VITE_SUPERADMIN_EMAIL as string | undefined
	const isSuperadmin = superadminEmail && session?.data?.user.email.toLowerCase() === superadminEmail.toLowerCase()
	const { data: me } = useMe(Boolean(session?.data))

	return (
		<Sidebar collapsible="icon" {...props}>
			{me?.activeOrganization && (
				<SidebarHeader>
					<TeamSwitcher />
				</SidebarHeader>
			)}
			<SidebarContent>
				<NavMain items={navMain} />
				{me?.activeOrgMember?.role === 'owner' && <NavMain items={ownerNav} />}
				{isSuperadmin && <NavMain items={superadminNav} />}
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	)
}
