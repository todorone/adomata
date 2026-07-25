import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { createDb } from '../db'
import { organization } from '../db/schema'
import { createAuth, requireAuth } from '../logic/auth'
import { meResponseSchema } from '../client/me'
import type { Bindings } from '../index'
import type { ActiveOrgMember, ActiveOrganization } from '../client/me'

function serializeDate(value: Date) {
	return value.toISOString()
}

const meHono = new Hono<Bindings>()

meHono.use('*', requireAuth)

export const meRoutes = meHono.get('/', async c => {
	let activeOrgMember: ActiveOrgMember | null = null
	let activeOrganization: ActiveOrganization | null = null

	try {
		activeOrgMember = await createAuth(c.env).api.getActiveMember({
			headers: c.req.raw.headers,
		})
	} catch {
		activeOrgMember = null
	}

	if (activeOrgMember) {
		const [org] = await createDb(c.env.DB)
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				logo: organization.logo,
			})
			.from(organization)
			.where(eq(organization.id, activeOrgMember.organizationId))
			.limit(1)

		activeOrganization = org ?? null
	}

	const authSession = c.get('authSession')
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
		}),
	)
})
