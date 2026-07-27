import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { db } from '../db'
import { member, organization } from '../db/schema'

export const HQ_SLUG = 'hq'
export const HQ_NAME = 'HQ'

// Idempotently gives the superuser a real Agency for Agency-scoped work. An
// existing non-HQ use of the reserved slug is deliberately rejected.
export async function ensureSuperadminHq(userId: string): Promise<string> {
	const [created] = await db
		.insert(organization)
		.values({ id: randomUUID(), name: HQ_NAME, slug: HQ_SLUG, createdAt: new Date() })
		.onConflictDoNothing({ target: organization.slug })
		.returning({ id: organization.id })

	const hqId =
		created?.id ??
		(await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, HQ_SLUG)).limit(1))[0]
			?.id
	if (!hqId) throw new Error('HQ Agency creation failed')

	const members = await db
		.select({ userId: member.userId, role: member.role })
		.from(member)
		.where(eq(member.organizationId, hqId))
	const superadmin = members.find(m => m.userId === userId)
	if (!created && members.length > 0 && superadmin?.role !== 'owner') {
		throw new Error('Reserved hq slug belongs to an Agency that cannot be safely adopted')
	}

	await db
		.insert(member)
		.values({ id: randomUUID(), organizationId: hqId, userId, role: 'owner', createdAt: new Date() })
		.onConflictDoUpdate({ target: [member.userId, member.organizationId], set: { role: 'owner' } })

	return hqId
}
