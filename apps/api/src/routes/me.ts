import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db'
import { member, organization } from '../db/schema'
import { setActiveAgency } from '../logic/activeAgency'
import { requireAuth, requireVerifiedAuth } from '../logic/auth'
import { apiError } from '../logic/apiError'
import { isSuperadminRole } from '../logic/superadmin'
import { meResponseSchema } from '../client/me'
import type { ActiveOrgMember, ActiveOrganization } from '../client/me'

function serializeDate(value: Date) {
	return value.toISOString()
}

const meHono = new Hono()

meHono.use('*', requireAuth, requireVerifiedAuth)

const withGetMeRoute = meHono.get('/', async c => {
	const authSession = c.get('authSession')
	const memberships = await db
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			logo: organization.logo,
			role: member.role,
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(eq(member.userId, authSession.user.id))
		.orderBy(asc(organization.name))

	const activeOrganizationId = authSession.session.activeOrganizationId ?? null
	const activeMembership = activeOrganizationId
		? (memberships.find(agency => agency.id === activeOrganizationId) ?? null)
		: null
	const activeOrganization: ActiveOrganization | null = activeMembership
		? {
				id: activeMembership.id,
				name: activeMembership.name,
				slug: activeMembership.slug,
				logo: activeMembership.logo,
			}
		: null
	const activeOrgMember: ActiveOrgMember | null = activeMembership
		? ((
				await db
					.select({
						id: member.id,
						organizationId: member.organizationId,
						userId: member.userId,
						role: member.role,
					})
					.from(member)
					.where(and(eq(member.organizationId, activeMembership.id), eq(member.userId, authSession.user.id)))
					.limit(1)
			)[0] ?? null)
		: null

	return c.json(
		meResponseSchema.parse({
			session: {
				...authSession.session,
				expiresAt: serializeDate(authSession.session.expiresAt),
				createdAt: serializeDate(authSession.session.createdAt),
				updatedAt: serializeDate(authSession.session.updatedAt),
			},
			user: {
				...authSession.user,
				createdAt: serializeDate(authSession.user.createdAt),
				updatedAt: serializeDate(authSession.user.updatedAt),
			},
			activeOrgMember,
			activeOrganization,
			memberships,
			isSuperadmin: isSuperadminRole(authSession.user.role),
		}),
	)
})

const switchActiveAgencySchema = z.object({ organizationId: z.string().min(1) })

export const meRoutes = withGetMeRoute.post(
	'/active-organization',
	zValidator('json', switchActiveAgencySchema),
	async c => {
		const authSession = c.get('authSession')
		const { organizationId } = c.req.valid('json')
		const [membership] = await db
			.select({ id: member.id })
			.from(member)
			.where(and(eq(member.organizationId, organizationId), eq(member.userId, authSession.user.id)))
			.limit(1)
		if (!membership) return apiError(c, 'FORBIDDEN', { message: 'Ви не є учасником цієї агенції' })

		await setActiveAgency(authSession.session.token, organizationId)
		return c.body(null, 204)
	},
)
