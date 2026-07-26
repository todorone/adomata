import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, eq, asc } from 'drizzle-orm'

import { db } from '../db'
import { invitation, member, organization, users } from '../db/schema'
import { createAuth, requireAuth } from '../logic/auth'
import { sendInvitationEmail } from '../logic/email'
import { acceptInvitationForExistingVerifiedUser } from '../logic/invitation'
import {
	adminOrganizationsResponseSchema,
	createAdminOrganizationRequestSchema,
	createAdminOrganizationResponseSchema,
} from '../client/admin/organizations'
import { adminInvitationsResponseSchema } from '../client/admin/invitations'
import {
	adminUsersResponseSchema,
	updateAdminUserBodySchema,
	updateAdminUserResponseSchema,
} from '../client/admin/users'
import { apiError } from '../logic/apiError'

function isSuperadmin(email: string, superadminEmail?: string) {
	return Boolean(superadminEmail && email.toLowerCase() === superadminEmail.toLowerCase())
}

function serializeOrganization(org: typeof organization.$inferSelect) {
	return {
		id: org.id,
		name: org.name,
		slug: org.slug,
		logo: org.logo,
		createdAt: org.createdAt.toISOString(),
	}
}

const adminHono = new Hono()

adminHono.use('*', requireAuth)

const withCreateOrganizationRoutes = adminHono.post(
	'/organizations',
	zValidator('json', createAdminOrganizationRequestSchema, (result, c) => {
		if (!result.success)
			return apiError(c, 'BAD_REQUEST', { message: 'Invalid request', details: result.error.issues })
	}),
	async c => {
		const { email: callerEmail, id: callerId, name: callerName } = c.get('authSession').user

		if (!isSuperadmin(callerEmail, process.env.SUPERADMIN_EMAIL)) {
			return apiError(c, 'FORBIDDEN', { message: 'Forbidden' })
		}

		const body = c.req.valid('json')
		const auth = createAuth()
		const org = await auth.api.createOrganization({
			body: {
				name: body.orgName,
				slug: body.orgSlug,
				userId: callerId,
			},
		})

		let invitationId: string | null = null
		if (body.firstOwnerEmail.toLowerCase() !== callerEmail.toLowerCase()) {
			const ownerInvitation = await auth.api.createInvitation({
				body: {
					organizationId: org.id,
					email: body.firstOwnerEmail,
					role: 'owner',
				},
				headers: c.req.raw.headers,
			})
			invitationId = ownerInvitation.id
			await sendInvitationEmail({
				email: body.firstOwnerEmail,
				organizationName: org.name,
				inviterName: callerName || callerEmail,
				role: 'owner',
			})
			await acceptInvitationForExistingVerifiedUser(ownerInvitation)

			await db.delete(member).where(and(eq(member.organizationId, org.id), eq(member.userId, callerId)))
		}

		return c.json(
			createAdminOrganizationResponseSchema.parse({
				org: {
					id: org.id,
					name: org.name,
					slug: org.slug,
					logo: org.logo ?? null,
				},
				invitationId,
			}),
			201,
		)
	},
)

const withListOrganizationRoutes = withCreateOrganizationRoutes.get('/organizations', async c => {
	const { email: callerEmail } = c.get('authSession').user

	if (!isSuperadmin(callerEmail, process.env.SUPERADMIN_EMAIL)) {
		return apiError(c, 'FORBIDDEN', { message: 'Forbidden' })
	}

	const organizations = await db.select().from(organization)
	return c.json(adminOrganizationsResponseSchema.parse({ organizations: organizations.map(serializeOrganization) }))
})

const withListInvitationRoutes = withListOrganizationRoutes.get('/invitations', async c => {
	const { email: callerEmail } = c.get('authSession').user

	if (!isSuperadmin(callerEmail, process.env.SUPERADMIN_EMAIL)) {
		return apiError(c, 'FORBIDDEN', { message: 'Forbidden' })
	}

	const rows = await db
		.select({
			id: invitation.id,
			organizationId: invitation.organizationId,
			organizationName: organization.name,
			email: invitation.email,
			role: invitation.role,
			status: invitation.status,
			expiresAt: invitation.expiresAt,
			createdAt: invitation.createdAt,
			inviterId: invitation.inviterId,
		})
		.from(invitation)
		.innerJoin(organization, eq(invitation.organizationId, organization.id))
		.orderBy(asc(invitation.createdAt))

	return c.json(
		adminInvitationsResponseSchema.parse({
			invitations: rows.map(row => ({
				...row,
				expiresAt: row.expiresAt.toISOString(),
				createdAt: row.createdAt.toISOString(),
			})),
		}),
	)
})

const withDeleteOrganizationRoutes = withListInvitationRoutes.delete('/organizations/:id', async c => {
	const { email: callerEmail } = c.get('authSession').user

	if (!isSuperadmin(callerEmail, process.env.SUPERADMIN_EMAIL)) {
		return apiError(c, 'FORBIDDEN', { message: 'Forbidden' })
	}

	await db.delete(organization).where(eq(organization.id, c.req.param('id')))
	return c.body(null, 204)
})

const withListUsersRoutes = withDeleteOrganizationRoutes.get('/users', async c => {
	const { email: callerEmail } = c.get('authSession').user

	if (!isSuperadmin(callerEmail, process.env.SUPERADMIN_EMAIL)) {
		return apiError(c, 'FORBIDDEN', { message: 'Forbidden' })
	}

	const rows = await db.select().from(users).orderBy(asc(users.createdAt))
	return c.json(
		adminUsersResponseSchema.parse({
			users: rows.map(u => ({
				...u,
				createdAt: u.createdAt.toISOString(),
				updatedAt: u.updatedAt.toISOString(),
			})),
		}),
	)
})

const withUpdateUserRoutes = withListUsersRoutes.patch(
	'/users/:id',
	zValidator('json', updateAdminUserBodySchema, (result, c) => {
		if (!result.success)
			return apiError(c, 'BAD_REQUEST', { message: 'Invalid request', details: result.error.issues })
	}),
	async c => {
		const { email: callerEmail } = c.get('authSession').user

		if (!isSuperadmin(callerEmail, process.env.SUPERADMIN_EMAIL)) {
			return apiError(c, 'FORBIDDEN', { message: 'Forbidden' })
		}

		const body = c.req.valid('json')
		const id = c.req.param('id')

		const [updated] = await db
			.update(users)
			.set({ ...(body.name && { name: body.name }), ...(body.email && { email: body.email }) })
			.where(eq(users.id, id))
			.returning()

		if (!updated) return apiError(c, 'NOT_FOUND', { message: 'User not found' })

		return c.json(
			updateAdminUserResponseSchema.parse({
				user: {
					...updated,
					createdAt: updated.createdAt.toISOString(),
					updatedAt: updated.updatedAt.toISOString(),
				},
			}),
		)
	},
)

export const adminRoutes = withUpdateUserRoutes.delete('/users/:id', async c => {
	const { email: callerEmail } = c.get('authSession').user

	if (!isSuperadmin(callerEmail, process.env.SUPERADMIN_EMAIL)) {
		return apiError(c, 'FORBIDDEN', { message: 'Forbidden' })
	}

	await db.delete(users).where(eq(users.id, c.req.param('id')))
	return c.body(null, 204)
})
