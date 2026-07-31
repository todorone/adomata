import { eq } from 'drizzle-orm'

import { db } from '../db'
import { member } from '../db/schema'
import { ensureSuperadminHq } from './hq'
import { acceptPendingInvitationForVerifiedSession } from './invitation'
import { setActiveAgency } from './sessionAgency'
import { isSuperadminRole } from './superadmin'

async function firstMembershipForUser(userId: string) {
	const [membership] = await db
		.select({ organizationId: member.organizationId })
		.from(member)
		.where(eq(member.userId, userId))
		.limit(1)
	return membership
}

// Every signed-in user with a membership needs a selected Agency. The configured
// superuser gets an Agency of its own, rather than bypassing Agency-scoped routes.
export async function restoreActiveAgency(
	session: {
		token: string
		userId: string
		activeOrganizationId?: string | null
	},
	user: { email: string; emailVerified: boolean; role: string },
) {
	if (session.activeOrganizationId) return session.activeOrganizationId
	if (!user.emailVerified) return null

	let agencyId: string | null | undefined = isSuperadminRole(user.role)
		? await ensureSuperadminHq(session.userId)
		: (await firstMembershipForUser(session.userId))?.organizationId
	if (!agencyId) {
		agencyId = await acceptPendingInvitationForVerifiedSession({ email: user.email, sessionToken: session.token })
	}
	if (!agencyId) return null

	await setActiveAgency(session.token, agencyId)
	return agencyId
}
