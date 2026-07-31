import { randomUUID } from 'node:crypto'

import { and, asc, eq, gt, ilike } from 'drizzle-orm'

import { db } from '../db'
import { invitation, member, users } from '../db/schema'

export async function acceptPendingInvitationForVerifiedSession(params: {
	email: string
	acceptInvitation: (invitationId: string) => Promise<unknown>
}) {
	const normalizedEmail = params.email.toLowerCase()
	const [pendingInvitation] = await db
		.select({ id: invitation.id, organizationId: invitation.organizationId })
		.from(invitation)
		.where(
			and(
				eq(invitation.email, normalizedEmail),
				eq(invitation.status, 'pending'),
				gt(invitation.expiresAt, new Date()),
			),
		)
		.orderBy(asc(invitation.createdAt))
		.limit(1)

	if (!pendingInvitation) return null

	await params.acceptInvitation(pendingInvitation.id)
	return pendingInvitation.organizationId
}

export async function acceptInvitationForExistingVerifiedUser(
	inv: Pick<typeof invitation.$inferSelect, 'id' | 'email' | 'organizationId' | 'role'>,
) {
	const [invitee] = await db
		.select({ id: users.id, emailVerified: users.emailVerified })
		.from(users)
		.where(ilike(users.email, inv.email))
		.limit(1)

	if (!invitee?.emailVerified) return false

	const [existingMembership] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.userId, invitee.id), eq(member.organizationId, inv.organizationId)))
		.limit(1)

	if (existingMembership) return false

	const [createdMembership] = await db
		.insert(member)
		.values({
			id: randomUUID(),
			organizationId: inv.organizationId,
			userId: invitee.id,
			role: inv.role,
			createdAt: new Date(),
		})
		.onConflictDoNothing({ target: [member.userId, member.organizationId] })
		.returning({ id: member.id })

	if (!createdMembership) return false

	await db
		.update(invitation)
		.set({ status: 'accepted' })
		.where(and(eq(invitation.id, inv.id), eq(invitation.status, 'pending')))

	return true
}
