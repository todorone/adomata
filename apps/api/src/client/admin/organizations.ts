import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

import { organization } from '../../db/schema'
import { isoDate } from '../scalars'

const organizationRow = createSelectSchema(organization, {
	createdAt: isoDate,
	updatedAt: isoDate.nullable(),
})

export const adminOrganizationSchema = organizationRow.pick({
	id: true,
	name: true,
	slug: true,
	logo: true,
	createdAt: true,
})
export type AdminOrganization = z.infer<typeof adminOrganizationSchema>

export const adminOrganizationsResponseSchema = z.object({
	organizations: z.array(adminOrganizationSchema),
})

export const createAdminOrganizationBodySchema = z.object({
	orgName: z.string().trim().min(1),
	orgSlug: z.string().trim().toLowerCase().min(1),
	firstOwnerEmail: z.email(),
})
export type CreateAdminOrganizationBody = z.infer<typeof createAdminOrganizationBodySchema>

export const createAdminOrganizationRequestSchema = z.union([
	createAdminOrganizationBodySchema,
	z
		.object({
			orgName: z.string().trim().min(1),
			orgSlug: z.string().trim().toLowerCase().min(1),
			firstAdminEmail: z.email(),
		})
		.transform(({ firstAdminEmail, ...body }) => ({ ...body, firstOwnerEmail: firstAdminEmail })),
])

export const createAdminOrganizationResponseSchema = z.object({
	org: adminOrganizationSchema.pick({
		id: true,
		name: true,
		slug: true,
		logo: true,
	}),
	invitationId: z.string().nullable(),
})
