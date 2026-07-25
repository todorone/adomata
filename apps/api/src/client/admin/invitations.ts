import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

import { invitation } from '../../db/schema'
import { isoDate } from '../scalars'

const invitationRow = createSelectSchema(invitation, {
	expiresAt: isoDate,
	createdAt: isoDate,
})

export const adminInvitationSchema = invitationRow
	.pick({
		id: true,
		organizationId: true,
		email: true,
		role: true,
		status: true,
		expiresAt: true,
		createdAt: true,
		inviterId: true,
	})
	.extend({
		organizationName: z.string(),
	})
export type AdminInvitation = z.infer<typeof adminInvitationSchema>

export const adminInvitationsResponseSchema = z.object({
	invitations: z.array(adminInvitationSchema),
})
