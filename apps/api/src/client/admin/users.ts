import { createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'

import { users } from '../../db/schema'
import { isoDate } from '../scalars'

const userRow = createSelectSchema(users, {
	createdAt: isoDate,
	updatedAt: isoDate,
})

export const adminUserSchema = userRow.pick({
	id: true,
	name: true,
	email: true,
	emailVerified: true,
	createdAt: true,
})
export type AdminUser = z.infer<typeof adminUserSchema>

export const adminUsersResponseSchema = z.object({
	users: z.array(adminUserSchema),
})

export const updateAdminUserBodySchema = z.object({
	name: z.string().min(1).optional(),
	email: z.email().optional(),
})
export type UpdateAdminUserBody = z.infer<typeof updateAdminUserBodySchema>

export const updateAdminUserResponseSchema = z.object({
	user: adminUserSchema,
})
