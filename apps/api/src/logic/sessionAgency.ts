import { eq } from 'drizzle-orm'

import { db } from '../db'
import { sessions } from '../db/schema'

export async function setActiveAgency(token: string, agencyId: string) {
	await db.update(sessions).set({ activeOrganizationId: agencyId }).where(eq(sessions.token, token))
}
