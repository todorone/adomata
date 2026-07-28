import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { useMe } from '@/data/me'
import { useOrganizationSettings, useUpdateOrganizationSettings } from '@/data/organization-settings'
import { requireSession } from '@/data/session'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'

export const Route = createFileRoute('/organization/settings')({
	beforeLoad: () => requireSession(),
	component: OrganizationSettingsPage,
})

function OrganizationSettingsForm() {
	const { data: settings, isLoading, isError } = useOrganizationSettings()
	const update = useUpdateOrganizationSettings()
	const [token, setToken] = useState('')

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		update.mutate({ metaAccessToken: token }, { onSuccess: () => setToken('') })
	}

	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-semibold">Налаштування агенції</h1>

			{isLoading && <p className="text-muted-foreground text-sm">Завантаження…</p>}
			{isError && <p className="text-destructive text-sm">Не вдалося завантажити налаштування.</p>}

			{settings && (
				<form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="meta-token">Токен Meta</Label>
						<Input
							id="meta-token"
							type="password"
							autoComplete="off"
							value={token}
							onChange={e => setToken(e.target.value)}
							placeholder={settings.hasToken ? '••••••••••••' : 'Вставте токен доступу Meta'}
							required
						/>
						<p className="text-muted-foreground text-sm">
							{settings.hasToken
								? settings.lastValidatedAt
									? `Останнє успішне підключення: ${new Date(settings.lastValidatedAt).toLocaleString('uk-UA')}`
									: 'Токен збережено.'
								: 'Токен ще не налаштовано.'}
						</p>
					</div>
					<Button type="submit" disabled={update.isPending}>
						{update.isPending ? 'Збереження…' : 'Зберегти'}
					</Button>
					{update.isError && <p className="text-destructive text-sm">{update.error.message}</p>}
				</form>
			)}
		</div>
	)
}

function OrganizationSettingsPage() {
	const { data: me } = useMe()

	if (me && me.activeOrgMember?.role !== 'owner') {
		return (
			<div className="flex flex-col gap-6">
				<h1 className="text-2xl font-semibold">Налаштування агенції</h1>
				<p className="text-muted-foreground text-sm">Ці налаштування доступні лише власнику агенції.</p>
			</div>
		)
	}

	return <OrganizationSettingsForm />
}
