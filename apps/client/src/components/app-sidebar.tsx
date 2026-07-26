import * as React from 'react'
import { Building2, LayoutDashboard, Sparkles, Users, UsersRound } from 'lucide-react'

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

const prototypeNav = [
	{
		title: 'Прототип №13 · Флотська дошка',
		url: '/prototype/fleet-board',
		icon: LayoutDashboard,
	},
	{
		title: 'Прототип №16 · Перегляд креативів',
		url: '/prototype/fleet-board',
		icon: Sparkles,
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
	const shouldFetchOrganization = Boolean(session?.data && !isSuperadmin)
	const { data: me } = useMe(shouldFetchOrganization)
	const organization = me?.activeOrganization

	return (
		<Sidebar collapsible="icon" {...props}>
			{organization && (
				<SidebarHeader>
					<TeamSwitcher teams={[{ name: organization.name, logo: Building2, plan: 'Агенція' }]} />
				</SidebarHeader>
			)}
			<SidebarContent>
				<NavMain items={navMain} />
				<NavMain items={prototypeNav} />
				{isSuperadmin && <NavMain items={superadminNav} />}
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	)
}
