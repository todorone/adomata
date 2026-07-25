import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@/data/session'

export const Route = createFileRoute('/')({
	beforeLoad: () => requireSession(),
	component: Home,
})

function Home() {
	return (
		<div className="grid auto-rows-min gap-4 md:grid-cols-3">
			<div className="aspect-video rounded-xl bg-muted/50" />
			<div className="aspect-video rounded-xl bg-muted/50" />
			<div className="aspect-video rounded-xl bg-muted/50" />
			<div className="col-span-3 min-h-[50vh] rounded-xl bg-muted/50" />
		</div>
	)
}
