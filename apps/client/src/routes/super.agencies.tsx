import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'

import { useConfirm } from '@/components/modal-provider'
import { useOrganizations, useCreateOrganization, useDeleteOrganization } from '@/data/admin/organizations'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'

export const Route = createFileRoute('/super/agencies')({
	component: SuperPage,
})

function CreateOrgDialog() {
	const [open, setOpen] = useState(false)
	const [orgName, setOrgName] = useState('')
	const [orgSlug, setOrgSlug] = useState('')
	const [firstOwnerEmail, setFirstOwnerEmail] = useState('')
	const createOrg = useCreateOrganization()

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		createOrg.mutate(
			{ orgName, orgSlug, firstOwnerEmail },
			{
				onSuccess: () => {
					setOpen(false)
					setOrgName('')
					setOrgSlug('')
					setFirstOwnerEmail('')
				},
			},
		)
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>Створити агенцію</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Створити агенцію</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="orgName">Назва агенції</Label>
						<Input
							id="orgName"
							value={orgName}
							onChange={e => setOrgName(e.target.value)}
							placeholder="Агенція «Вектор»"
							required
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="orgSlug">Слаг</Label>
						<Input
							id="orgSlug"
							value={orgSlug}
							onChange={e => setOrgSlug(e.target.value)}
							placeholder="acme"
							required
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="firstOwnerEmail">Електронна пошта власника агенції</Label>
						<Input
							id="firstOwnerEmail"
							type="email"
							value={firstOwnerEmail}
							onChange={e => setFirstOwnerEmail(e.target.value)}
							placeholder="owner@example.com"
							required
						/>
					</div>
					<Button type="submit" disabled={createOrg.isPending}>
						{createOrg.isPending ? 'Створення…' : 'Створити'}
					</Button>
					{createOrg.isError && <p className="text-sm text-destructive">Не вдалося створити агенцію.</p>}
				</form>
			</DialogContent>
		</Dialog>
	)
}

function SuperPage() {
	const { data: orgs, isLoading, isError } = useOrganizations()
	const deleteOrg = useDeleteOrganization()
	const confirm = useConfirm()

	async function handleDeleteOrganization(org: { id: string; name: string }) {
		const confirmed = await confirm({
			title: 'Видалити агенцію?',
			description: `Це остаточно видалить ${org.name}. Цю дію неможливо скасувати.`,
		})

		if (confirmed) {
			deleteOrg.mutate(org.id)
		}
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Агенції</h1>
				<CreateOrgDialog />
			</div>

			{isLoading && <p className="text-muted-foreground text-sm">Завантаження…</p>}
			{isError && <p className="text-sm text-destructive">Не вдалося завантажити агенції.</p>}

			{orgs && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Назва</TableHead>
							<TableHead>Слаг</TableHead>
							<TableHead>Створено</TableHead>
							<TableHead className="w-16" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{orgs.length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="text-muted-foreground text-center">
									Поки що немає агенцій.
								</TableCell>
							</TableRow>
						)}
						{orgs.map(org => (
							<TableRow key={org.id}>
								<TableCell className="font-medium">{org.name}</TableCell>
								<TableCell className="text-muted-foreground">{org.slug ?? '—'}</TableCell>
								<TableCell className="text-muted-foreground">
									{new Date(org.createdAt).toLocaleDateString()}
								</TableCell>
								<TableCell>
									<Button
										variant="ghost"
										size="icon"
										aria-label={`Видалити ${org.name}`}
										disabled={deleteOrg.isPending}
										onClick={() => {
											handleDeleteOrganization(org)
										}}
									>
										<Trash2 className="size-4 text-destructive" />
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</div>
	)
}
