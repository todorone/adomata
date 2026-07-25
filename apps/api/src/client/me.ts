import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

import { organization } from '../db/schema'
import { isoDate } from './scalars'

const organizationRow = createSelectSchema(organization, {
	createdAt: isoDate,
	updatedAt: isoDate.nullable(),
})

export const activeOrgMemberSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	userId: z.string(),
	role: z.enum(['owner', 'admin', 'member']),
})
export type ActiveOrgMember = z.infer<typeof activeOrgMemberSchema>

export const activeOrganizationSchema = organizationRow.pick({
	id: true,
	name: true,
	slug: true,
	logo: true,
})
export type ActiveOrganization = z.infer<typeof activeOrganizationSchema>

export const meResponseSchema = z.object({
	session: z.object({
		id: z.string(),
		token: z.string(),
		userId: z.string(),
		expiresAt: isoDate,
		createdAt: isoDate,
		updatedAt: isoDate,
		activeOrganizationId: z.string().nullish(),
	}),
	user: z.object({
		id: z.string(),
		email: z.string(),
		emailVerified: z.boolean(),
		name: z.string(),
		image: z.string().nullish(),
		createdAt: isoDate,
		updatedAt: isoDate,
	}),
	activeOrgMember: activeOrgMemberSchema.nullable(),
	activeOrganization: activeOrganizationSchema.nullable(),
})
export type Me = z.infer<typeof meResponseSchema>
