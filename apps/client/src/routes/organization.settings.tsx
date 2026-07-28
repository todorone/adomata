import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { ConnectMetaAccountItem } from '@adomata/api/client'

import { useMetaAccountsDiscovery, useConnectMetaAccounts } from '@/data/meta-accounts'
import { useMe } from '@/data/me'
import { useOrganizationSettings, useUpdateOrganizationSettings } from '@/data/organization-settings'
import { requireSession } from '@/data/session'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'

const newClientOption = '__new__'

type RowSelection = { kind: 'unset' } | { kind: 'client'; clientId: string } | { kind: 'new'; name: string }

function MetaAccountsSection() {
	const [discoveryEnabled, setDiscoveryEnabled] = useState(false)
	const discovery = useMetaAccountsDiscovery(discoveryEnabled)
	const connect = useConnectMetaAccounts()
	const [selections, setSelections] = useState<Record<string, RowSelection>>({})

	const accounts = discovery.data?.accounts ?? []
	const clients = discovery.data?.clients ?? []
	const connectedAccounts = accounts.filter(account => account.connected)
	const unconnectedAccounts = accounts.filter(account => !account.connected)

	function handleDiscover() {
		if (discoveryEnabled) discovery.refetch()
		else setDiscoveryEnabled(true)
	}

	function handleSelectChange(metaAccountId: string, value: string) {
		setSelections(prev => ({
			...prev,
			[metaAccountId]:
				value === ''
					? { kind: 'unset' }
					: value === newClientOption
						? { kind: 'new', name: '' }
						: { kind: 'client', clientId: value },
		}))
	}

	function handleNewClientNameChange(metaAccountId: string, name: string) {
		setSelections(prev => ({ ...prev, [metaAccountId]: { kind: 'new', name } }))
	}

	function handleConnect() {
		const items: ConnectMetaAccountItem[] = []
		for (const account of unconnectedAccounts) {
			const selection = selections[account.metaAccountId]
			if (!selection || selection.kind === 'unset') continue
			if (selection.kind === 'new' && !selection.name.trim()) continue
			items.push({
				metaAccountId: account.metaAccountId,
				name: account.name,
				currency: account.currency,
				timezoneName: account.timezoneName,
				...(selection.kind === 'client'
					? { clientId: selection.clientId }
					: { newClientName: selection.name.trim() }),
			})
		}
		if (items.length === 0) return
		connect.mutate({ accounts: items }, { onSuccess: () => setSelections({}) })
	}

	const hasReadySelection = unconnectedAccounts.some(account => {
		const selection = selections[account.metaAccountId]
		return (
			selection && (selection.kind === 'client' || (selection.kind === 'new' && selection.name.trim().length > 0))
		)
	})

	return (
		<div className="flex max-w-2xl flex-col gap-4">
			<h2 className="text-lg font-semibold">Рекламні кабінети Meta</h2>
			<div>
				<Button type="button" variant="outline" onClick={handleDiscover} disabled={discovery.isFetching}>
					{discovery.isFetching ? 'Пошук…' : 'Знайти рекламні кабінети'}
				</Button>
			</div>
			{discovery.isError && <p className="text-destructive text-sm">{discovery.error.message}</p>}

			{connectedAccounts.length > 0 && (
				<div className="flex flex-col gap-1">
					{connectedAccounts.map(account => (
						<p key={account.metaAccountId} className="text-sm">
							{account.name} — <span className="text-muted-foreground">Підключено до {account.clientName}</span>
						</p>
					))}
				</div>
			)}

			{unconnectedAccounts.length > 0 && (
				<div className="flex flex-col gap-3">
					{unconnectedAccounts.map(account => {
						const selection = selections[account.metaAccountId]
						const selectValue =
							!selection || selection.kind === 'unset'
								? ''
								: selection.kind === 'new'
									? newClientOption
									: selection.clientId
						return (
							<div
								key={account.metaAccountId}
								className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
							>
								<div>
									<p className="font-medium">{account.name}</p>
									<p className="text-muted-foreground text-sm">
										{account.currency}
										{account.timezoneName ? ` · ${account.timezoneName}` : ''}
									</p>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<select
										className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
										value={selectValue}
										onChange={e => handleSelectChange(account.metaAccountId, e.target.value)}
									>
										<option value="" disabled>
											Виберіть клієнта
										</option>
										{clients.map(clientOption => (
											<option key={clientOption.id} value={clientOption.id}>
												{clientOption.name}
											</option>
										))}
										<option value={newClientOption}>+ Новий клієнт</option>
									</select>
									{selection?.kind === 'new' && (
										<Input
											value={selection.name}
											onChange={e => handleNewClientNameChange(account.metaAccountId, e.target.value)}
											placeholder="Назва нового клієнта"
											className="w-48"
										/>
									)}
								</div>
							</div>
						)
					})}
					<div>
						<Button type="button" onClick={handleConnect} disabled={connect.isPending || !hasReadySelection}>
							{connect.isPending ? 'Підключення…' : 'Підключити'}
						</Button>
					</div>
					{connect.isError && <p className="text-destructive text-sm">{connect.error.message}</p>}
				</div>
			)}

			{discoveryEnabled && !discovery.isFetching && !discovery.isError && accounts.length === 0 && (
				<p className="text-muted-foreground text-sm">Рекламні кабінети не знайдено.</p>
			)}
		</div>
	)
}

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

			{settings?.hasToken && <MetaAccountsSection />}
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
