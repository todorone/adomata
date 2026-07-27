import { useNavigate, createFileRoute } from '@tanstack/react-router'

import { useConfirm } from '@/components/modal-provider'
import { useWipeDatabase } from '@/data/database'
import { useMe } from '@/data/me'
import { Button } from '@/ui/button'

export const Route = createFileRoute('/super/database')({
	component: SuperDatabasePage,
})

export function WipeDatabase() {
	const confirm = useConfirm()
	const navigate = useNavigate()
	const wipe = useWipeDatabase()

	async function onWipe() {
		const confirmed = await confirm({
			title: 'Очистити всю базу даних?',
			description:
				'Це назавжди видалить усі дані платформи, включно з усіма користувачами та вашим обліковим записом суперадміністратора. ' +
				'Вас буде розлогінено, а платформу доведеться налаштувати з нуля. Цю дію неможливо скасувати.',
			confirmLabel: 'Очистити все',
		})

		if (confirmed) wipe.mutate(undefined, { onSuccess: () => navigate({ to: '/login' }) })
	}

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="text-2xl font-semibold">Очистити базу даних</h1>
				<p className="text-muted-foreground text-sm">
					Назавжди видалити всі дані платформи, включно з усіма користувачами. Цю дію неможливо скасувати.
				</p>
			</div>

			<div>
				<Button variant="destructive" disabled={wipe.isPending} onClick={onWipe}>
					{wipe.isPending ? 'Очищення…' : 'Очистити базу даних'}
				</Button>
			</div>

			{wipe.isError && <p className="text-destructive text-sm">Не вдалося очистити базу даних.</p>}
		</div>
	)
}

function SuperDatabasePage() {
	const { data } = useMe()

	if (data && !data.isSuperadmin) {
		return <p className="text-muted-foreground text-sm">Керування базою даних доступне лише суперадміністраторам.</p>
	}

	return <WipeDatabase />
}
