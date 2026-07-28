import { z } from 'zod'

import { isoDate } from './scalars'

export const organizationSettingsResponseSchema = z.object({
	hasToken: z.boolean(),
	updatedAt: isoDate.nullable(),
	lastValidatedAt: isoDate.nullable(),
})
export type OrganizationSettingsResponse = z.infer<typeof organizationSettingsResponseSchema>

export const updateOrganizationSettingsBodySchema = z.object({
	metaAccessToken: z.string().trim().min(1).max(2000),
})
export type UpdateOrganizationSettingsBody = z.infer<typeof updateOrganizationSettingsBodySchema>
