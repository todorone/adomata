import { eq } from 'drizzle-orm'

import { db } from '../db'
import { member, sessions } from '../db/schema'
import { ensureSuperadminHq } from './hq'
import { isSuperadmin } from './superadmin'

async function firstMembershipForUser(userId: string) {
	const [membership] = await db
		.select({ organizationId: member.organizationId })
		.from(member)
		.where(eq(member.userId, userId))
		.limit(1)
	return membership
}

export async function setActiveAgency(token: string, agencyId: string) {
	await db.update(sessions).set({ activeOrganizationId: agencyId }).where(eq(sessions.token, token))
}

// Every signed-in user with a membership needs a selected Agency. The configured
// superuser gets an Agency of its own, rather than bypassing Agency-scoped routes.
export async function restoreActiveAgency(
	session: {
		token: string
		userId: string
		activeOrganizationId?: string | null
	},
	email: string,
) {
	if (session.activeOrganizationId) return session.activeOrganizationId

	const agencyId = isSuperadmin(email)
		? await ensureSuperadminHq(session.userId)
		: (await firstMembershipForUser(session.userId))?.organizationId
	if (!agencyId) return null

	await setActiveAgency(session.token, agencyId)
	return agencyId
}
