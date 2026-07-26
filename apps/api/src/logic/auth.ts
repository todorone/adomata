import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins/bearer'
import { organization } from 'better-auth/plugins/organization'
import { and, eq, gt } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'

import { db } from '../db'
import * as schema from '../db/schema'
import { invitation, member, sessions } from '../db/schema'
import { apiError } from './apiError'

export type AuthSession = {
	session: {
		id: string
		token: string
		userId: string
		expiresAt: Date
		createdAt: Date
		updatedAt: Date
		activeOrganizationId?: string | null
	}
	user: {
		id: string
		email: string
		emailVerified: boolean
		name: string
		image?: string | null
		createdAt: Date
		updatedAt: Date
	}
}

export type OrgMember = {
	id: string
	organizationId: string
	userId: string
	role: 'owner' | 'admin' | 'member'
}

export async function restoreActiveOrganization(session: {
	token: string
	userId: string
	activeOrganizationId?: string | null
}) {
	if (session.activeOrganizationId) return
	const [membership] = await db
		.select({ organizationId: member.organizationId })
		.from(member)
		.where(eq(member.userId, session.userId))
		.limit(1)
	if (!membership) return
	await db
		.update(sessions)
		.set({ activeOrganizationId: membership.organizationId })
		.where(eq(sessions.token, session.token))
}

export function createAuth() {
	return betterAuth({
		baseURL: process.env.BETTER_AUTH_URL,
		basePath: '/auth',
		secret: process.env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema,
			camelCase: true,
		}),
		emailAndPassword: {
			enabled: true,
		},
		trustedOrigins: request => {
			const base = ['https://appleid.apple.com', 'https://*.adomata.com']
			const origin = request?.headers.get('origin') ?? ''
			try {
				const { hostname } = new URL(origin)
				if (hostname === 'localhost' || hostname.endsWith('.adomata.com')) {
					return [...base, origin]
				}
			} catch {
				// ignore malformed origins
			}
			return base
		},
		socialProviders: {
			google:
				process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
					? {
							clientId: process.env.GOOGLE_CLIENT_ID,
							clientSecret: process.env.GOOGLE_CLIENT_SECRET,
						}
					: undefined,
			apple:
				process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET
					? {
							clientId: process.env.APPLE_CLIENT_ID,
							clientSecret: process.env.APPLE_CLIENT_SECRET,
						}
					: undefined,
		},
		databaseHooks: {
			user: {
				create: {
					before: async user => {
						if (!(await canSignUpWithEmail(user.email))) {
							return false
						}
					},
				},
			},
			session: {
				create: {
					after: async session => restoreActiveOrganization(session),
				},
			},
		},
		plugins: [
			bearer(),
			organization({
				invitationExpiresIn: 60 * 60 * 24 * 7,
				allowUserToCreateOrganization: false,
			}),
		],
	})
}

export async function canSignUpWithEmail(email: string) {
	const normalizedEmail = email.toLowerCase()

	if (process.env.SUPERADMIN_EMAIL && normalizedEmail === process.env.SUPERADMIN_EMAIL.toLowerCase()) {
		return true
	}

	const pendingInvitation = await db
		.select({ id: invitation.id })
		.from(invitation)
		.where(
			and(
				eq(invitation.email, normalizedEmail),
				eq(invitation.status, 'pending'),
				gt(invitation.expiresAt, new Date()),
			),
		)
		.limit(1)

	return pendingInvitation.length > 0
}

export const requireAuth = createMiddleware(async (c, next) => {
	const session = (await createAuth().api.getSession({
		headers: c.req.raw.headers,
	})) as AuthSession | null

	if (!session) return apiError(c, 'UNAUTHORIZED')

	c.set('authSession', session)

	return next()
})

export const requireOrg = createMiddleware(async (c, next) => {
	let member: OrgMember | null = null

	try {
		member = (await createAuth().api.getActiveMember({
			headers: c.req.raw.headers,
		})) as OrgMember | null
	} catch {
		return apiError(c, 'NO_ACTIVE_ORGANIZATION', { message: 'No active organization' })
	}

	if (!member) return apiError(c, 'NO_ACTIVE_ORGANIZATION', { message: 'No active organization' })

	c.set('orgId', member.organizationId)
	c.set('orgMember', member)

	return next()
})

declare module 'hono' {
	interface ContextVariableMap {
		authSession: AuthSession
		orgId: string
		orgMember: OrgMember
	}
}
