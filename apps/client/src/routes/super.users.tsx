import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'

import { useConfirm } from '@/components/modal-provider'
import { useUsers, useUpdateUser, useDeleteUser } from '@/data/admin/users'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import type { AdminUser } from '@adomata/api/client'

export const Route = createFileRoute('/super/users')({
	component: SuperUsersPage,
})

function EditUserDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
	const [name, setName] = useState(user.name)
	const [email, setEmail] = useState(user.email)
	const updateUser = useUpdateUser()

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		updateUser.mutate({ id: user.id, name, email }, { onSuccess: onClose })
	}

	return (
		<Dialog open onOpenChange={open => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit User</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="name">Name</Label>
						<Input
							id="name"
							value={name}
							onChange={e => setName(e.target.value)}
							placeholder="Full name"
							required
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="email">Email</Label>
						<Input
							id="email"
							type="email"
							value={email}
							onChange={e => setEmail(e.target.value)}
							placeholder="user@example.com"
							required
						/>
					</div>
					<Button type="submit" disabled={updateUser.isPending}>
						{updateUser.isPending ? 'Saving…' : 'Save'}
					</Button>
					{updateUser.isError && <p className="text-sm text-destructive">Failed to update user.</p>}
				</form>
			</DialogContent>
		</Dialog>
	)
}

function SuperUsersPage() {
	const { data: userList, isLoading, isError } = useUsers()
	const deleteUser = useDeleteUser()
	const confirm = useConfirm()
	const [editingUser, setEditingUser] = useState<AdminUser | null>(null)

	async function handleDeleteUser(user: AdminUser) {
		const confirmed = await confirm({
			title: 'Delete user?',
			description: `This will permanently delete ${user.name}. This action cannot be undone.`,
		})

		if (confirmed) {
			deleteUser.mutate(user.id)
		}
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Users</h1>
			</div>

			{isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
			{isError && <p className="text-sm text-destructive">Failed to load users.</p>}

			{userList && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Email</TableHead>
							<TableHead>Verified</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-24" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{userList.length === 0 && (
							<TableRow>
								<TableCell colSpan={5} className="text-muted-foreground text-center">
									No users yet.
								</TableCell>
							</TableRow>
						)}
						{userList.map(u => (
							<TableRow key={u.id}>
								<TableCell className="font-medium">{u.name}</TableCell>
								<TableCell className="text-muted-foreground">{u.email}</TableCell>
								<TableCell className="text-muted-foreground">{u.emailVerified ? 'Yes' : 'No'}</TableCell>
								<TableCell className="text-muted-foreground">
									{new Date(u.createdAt).toLocaleDateString()}
								</TableCell>
								<TableCell className="flex gap-1">
									<Button
										variant="ghost"
										size="icon"
										aria-label={`Edit ${u.name}`}
										onClick={() => setEditingUser(u)}
									>
										<Pencil className="size-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label={`Delete ${u.name}`}
										disabled={deleteUser.isPending}
										onClick={() => {
											handleDeleteUser(u)
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

			{editingUser && <EditUserDialog user={editingUser} onClose={() => setEditingUser(null)} />}
		</div>
	)
}
