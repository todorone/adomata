import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { X } from 'lucide-react'

import { useConfirm } from '@/components/modal-provider'
import {
	useInvitations,
	useAdminInvitations,
	useInviteMember,
	useCancelInvitation,
	type InviteRole,
	type AdminInvitation,
} from '@/data/invitations'
import { requireSession, useSession } from '@/data/session'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'

export const Route = createFileRoute('/users/invites')({
	beforeLoad: () => requireSession(),
	component: InvitesPage,
})

const ROLES: InviteRole[] = ['member', 'admin']

const ROLE_LABELS: Record<InviteRole, string> = {
	member: 'Учасник',
	admin: 'Адміністратор',
	owner: 'Власник',
}

const STATUS_LABELS: Record<string, string> = {
	pending: 'Очікує',
	accepted: 'Прийнято',
	rejected: 'Відхилено',
	canceled: 'Скасовано',
}

function InviteDialog() {
	const [open, setOpen] = useState(false)
	const [email, setEmail] = useState('')
	const [role, setRole] = useState<InviteRole>('member')
	const invite = useInviteMember()

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		invite.mutate(
			{ email, role },
			{
				onSuccess: () => {
					setOpen(false)
					setEmail('')
					setRole('member')
				},
			},
		)
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>Запросити користувача</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Запросити користувача</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
					<div className="flex flex-col gap-2">
						<Label htmlFor="role">Роль</Label>
						<select
							id="role"
							value={role}
							onChange={e => setRole(e.target.value as InviteRole)}
							className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
						>
							{ROLES.map(r => (
								<option key={r} value={r}>
									{ROLE_LABELS[r]}
								</option>
							))}
						</select>
					</div>
					<Button type="submit" disabled={invite.isPending}>
						{invite.isPending ? 'Надсилання…' : 'Надіслати запрошення'}
					</Button>
					{invite.isError && <p className="text-destructive text-sm">{invite.error.message}</p>}
				</form>
			</DialogContent>
		</Dialog>
	)
}

function statusBadgeClass(status: string) {
	switch (status) {
		case 'pending':
			return 'text-yellow-700 bg-yellow-50 border-yellow-200'
		case 'accepted':
			return 'text-green-700 bg-green-50 border-green-200'
		case 'rejected':
			return 'text-red-700 bg-red-50 border-red-200'
		case 'canceled':
			return 'text-muted-foreground bg-muted border-transparent'
		default:
			return 'text-muted-foreground bg-muted border-transparent'
	}
}

function AdminInvitesPage() {
	const { data: invitations, isLoading, isError } = useAdminInvitations()

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Запрошення</h1>
			</div>

			{isLoading && <p className="text-muted-foreground text-sm">Завантаження…</p>}
			{isError && <p className="text-destructive text-sm">Не вдалося завантажити запрошення.</p>}

			{invitations && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Агенція</TableHead>
							<TableHead>Email</TableHead>
							<TableHead>Роль</TableHead>
							<TableHead>Статус</TableHead>
							<TableHead>Закінчується</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{invitations.length === 0 && (
							<TableRow>
								<TableCell colSpan={5} className="text-muted-foreground text-center">
									Поки що немає запрошень.
								</TableCell>
							</TableRow>
						)}
						{invitations.map((inv: AdminInvitation) => (
							<TableRow key={inv.id}>
								<TableCell className="text-muted-foreground">{inv.organizationName}</TableCell>
								<TableCell className="font-medium">{inv.email}</TableCell>
								<TableCell className="text-muted-foreground">
									{ROLE_LABELS[inv.role as InviteRole] ?? inv.role}
								</TableCell>
								<TableCell>
									<span
										className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(inv.status)}`}
									>
										{STATUS_LABELS[inv.status] ?? inv.status}
									</span>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{new Date(inv.expiresAt).toLocaleDateString()}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</div>
	)
}

function InvitesPage() {
	const { data: session } = useSession()
	const superadminEmail = import.meta.env.VITE_SUPERADMIN_EMAIL as string | undefined
	const isSuperadmin = superadminEmail && session?.data?.user.email.toLowerCase() === superadminEmail.toLowerCase()

	const { data: invitations, isLoading, isError } = useInvitations(!isSuperadmin)
	const cancel = useCancelInvitation()
	const confirm = useConfirm()

	async function handleCancelInvitation(invitation: { id: string; email: string }) {
		const confirmed = await confirm({
			title: 'Скасувати запрошення?',
			description: `Це скасує очікуване запрошення для ${invitation.email}.`,
			confirmLabel: 'Скасувати запрошення',
		})

		if (confirmed) {
			cancel.mutate(invitation.id)
		}
	}

	if (isSuperadmin) return <AdminInvitesPage />

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Запрошення</h1>
				<InviteDialog />
			</div>

			{isLoading && <p className="text-muted-foreground text-sm">Завантаження…</p>}
			{isError && <p className="text-destructive text-sm">Не вдалося завантажити запрошення.</p>}

			{invitations && (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Email</TableHead>
							<TableHead>Роль</TableHead>
							<TableHead>Статус</TableHead>
							<TableHead>Закінчується</TableHead>
							<TableHead className="w-16" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{invitations.length === 0 && (
							<TableRow>
								<TableCell colSpan={5} className="text-muted-foreground text-center">
									Поки що немає запрошень.
								</TableCell>
							</TableRow>
						)}
						{invitations.map(inv => (
							<TableRow key={inv.id}>
								<TableCell className="font-medium">{inv.email}</TableCell>
								<TableCell className="text-muted-foreground">
									{ROLE_LABELS[inv.role as InviteRole] ?? inv.role}
								</TableCell>
								<TableCell>
									<span
										className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(inv.status)}`}
									>
										{STATUS_LABELS[inv.status] ?? inv.status}
									</span>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{new Date(inv.expiresAt).toLocaleDateString()}
								</TableCell>
								<TableCell>
									{inv.status === 'pending' && (
										<Button
											variant="ghost"
											size="icon"
											aria-label="Скасувати запрошення"
											disabled={cancel.isPending}
											onClick={() => {
												handleCancelInvitation(inv)
											}}
										>
											<X className="size-4 text-destructive" />
										</Button>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</div>
	)
}
