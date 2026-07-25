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
	const [firstAdminEmail, setFirstAdminEmail] = useState('')
	const createOrg = useCreateOrganization()

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		createOrg.mutate(
			{ orgName, orgSlug, firstAdminEmail },
			{
				onSuccess: () => {
					setOpen(false)
					setOrgName('')
					setOrgSlug('')
					setFirstAdminEmail('')
				},
			},
		)
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>Create Agency</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create Agency</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="orgName">Agency Name</Label>
						<Input
							id="orgName"
							value={orgName}
							onChange={e => setOrgName(e.target.value)}
							placeholder="Acme Inc"
							required
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="orgSlug">Slug</Label>
						<Input
							id="orgSlug"
							value={orgSlug}
							onChange={e => setOrgSlug(e.target.value)}
							placeholder="acme"
							required
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="firstAdminEmail">First Admin Email</Label>
						<Input
							id="firstAdminEmail"
							type="email"
							value={firstAdminEmail}
							onChange={e => setFirstAdminEmail(e.target.value)}
							placeholder="admin@acme.com"
							required
						/>
					</div>
					<Button type="submit" disabled={createOrg.isPending}>
						{createOrg.isPending ? 'Creating…' : 'Create'}
					</Button>
					{createOrg.isError && <p className="text-sm text-destructive">Failed to create agency.</p>}
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
			title: 'Delete agency?',
			description: `This will permanently delete ${org.name}. This action cannot be undone.`,
		})

		if (confirmed) {
			deleteOrg.mutate(org.id)
		}
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Agencies</h1>
				<CreateOrgDialog />
			</div>

			{isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
			{isError && <p className="text-sm text-destructive">Failed to load agencies.</p>}

			{orgs && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Slug</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-16" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{orgs.length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="text-muted-foreground text-center">
									No agencies yet.
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
										aria-label={`Delete ${org.name}`}
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
