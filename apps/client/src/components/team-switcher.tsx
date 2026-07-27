import { Building2, Check, ChevronsUpDown } from 'lucide-react'

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { useMe, useSwitchAgency } from '@/data/me'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/ui/sidebar'

function AgencyIcon() {
	return (
		<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
			<Building2 className="size-4" />
		</div>
	)
}

export function TeamSwitcher() {
	const { isMobile } = useSidebar()
	const { data } = useMe()
	const switchAgency = useSwitchAgency()
	const agencies = data?.memberships ?? []
	const activeAgency = data?.activeOrganization ?? null
	const name = activeAgency?.name ?? 'Adomata'

	if (agencies.length < 2) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton size="lg" asChild tooltip={name} className="cursor-default">
						<div>
							<AgencyIcon />
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-semibold">{name}</span>
							</div>
						</div>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		)
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							aria-label="Змінити агенцію"
							tooltip={name}
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<AgencyIcon />
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-semibold">{name}</span>
							</div>
							<ChevronsUpDown className="ml-auto" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-(--anchor-width) min-w-56 rounded-lg"
						align="start"
						side={isMobile ? 'bottom' : 'right'}
						sideOffset={4}
					>
						<DropdownMenuGroup>
							<DropdownMenuLabel className="text-xs text-muted-foreground">Агенції</DropdownMenuLabel>
						</DropdownMenuGroup>
						{agencies.map(agency => {
							const isActive = agency.id === activeAgency?.id
							return (
								<DropdownMenuItem
									key={agency.id}
									className="gap-2 p-2"
									onSelect={() => {
										if (!isActive) switchAgency.mutate(agency.id)
									}}
								>
									<div className="flex size-6 items-center justify-center rounded-md border">
										<Building2 className="size-3.5 shrink-0" />
									</div>
									<span className="truncate">{agency.name}</span>
									{isActive && <Check className="ml-auto size-4" />}
								</DropdownMenuItem>
							)
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	)
}
