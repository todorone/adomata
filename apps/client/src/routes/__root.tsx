import { Outlet, createRootRoute, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { AppSidebar } from '@/components/app-sidebar'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/ui/breadcrumb'
import { Separator } from '@/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/ui/sidebar'

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: 'utf-8',
			},
			{
				name: 'viewport',
				content: 'width=device-width, initial-scale=1',
			},
			{
				title: 'Adomata Дашборд',
			},
		],
	}),
	component: RootComponent,
})

function RootComponent() {
	const pathname = useRouterState({ select: s => s.location.pathname })
	const isAuthPage = pathname === '/login'

	if (isAuthPage) {
		return (
			<>
				<Outlet />
				<TanStackDevtools
					config={{ position: 'bottom-right' }}
					plugins={[{ name: 'Tanstack Router', render: <TanStackRouterDevtoolsPanel /> }]}
				/>
			</>
		)
	}

	return (
		<>
			<SidebarProvider>
				<AppSidebar />
				<SidebarInset>
					<header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
						<div className="flex items-center gap-2 px-4">
							<SidebarTrigger className="-ml-1" />
							<Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
							<Breadcrumb>
								<BreadcrumbList>
									<BreadcrumbItem>
										<BreadcrumbPage>Дашборд</BreadcrumbPage>
									</BreadcrumbItem>
								</BreadcrumbList>
							</Breadcrumb>
						</div>
					</header>
					<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
						<Outlet />
					</div>
				</SidebarInset>
			</SidebarProvider>
			<TanStackDevtools
				config={{ position: 'bottom-right' }}
				plugins={[{ name: 'Tanstack Router', render: <TanStackRouterDevtoolsPanel /> }]}
			/>
		</>
	)
}
