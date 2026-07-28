import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { APIError, betterAuth } from 'better-auth'
import { admin } from 'better-auth/plugins/admin'
import { adminAc, userAc } from 'better-auth/plugins/admin/access'
import { bearer } from 'better-auth/plugins/bearer'
import { organization } from 'better-auth/plugins/organization'
import { and, eq, gt } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'

import { db } from '../db'
import * as schema from '../db/schema'
import { invitation } from '../db/schema'
import { isAdomataEmail } from './adomataEmail'
import { restoreActiveAgency } from './activeAgency'
import { apiError } from './apiError'
import { sendInvitationEmail, sendVerificationEmail } from './email'
import { isBootstrapSuperadminEmail } from './superadmin'

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
		role: 'user' | 'super'
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

const ORGANIZATION_ROLES = ['owner', 'admin', 'member'] as const

function assertOrganizationRole(role: string) {
	if (!(ORGANIZATION_ROLES as readonly string[]).includes(role)) {
		throw new APIError('BAD_REQUEST', { message: 'Непідтримувана роль агенції' })
	}
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
			requireEmailVerification: true,
		},
		emailVerification: {
			sendOnSignUp: true,
			sendOnSignIn: true,
			sendVerificationEmail: async ({ user, url }) => {
				if (skipsEmailVerification(user.email)) return
				await sendVerificationEmail({ email: user.email, name: user.name, url })
			},
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
						const overrides: { emailVerified?: boolean; role?: 'user' | 'super' } = {}
						if (skipsEmailVerification(user.email)) overrides.emailVerified = true
						if (isBootstrapSuperadminEmail(user.email)) overrides.role = 'super'
						if (Object.keys(overrides).length > 0) {
							return { data: { ...user, ...overrides } }
						}
					},
				},
			},
			session: {
				create: {
					after: async session => {
						const [user] = await db
							.select({ role: schema.users.role })
							.from(schema.users)
							.where(eq(schema.users.id, session.userId))
							.limit(1)
						if (user) await restoreActiveAgency(session, user.role)
					},
				},
			},
		},
		plugins: [
			bearer(),
			admin({
				defaultRole: 'user',
				adminRoles: ['super'],
				// Renames the plugin's built-in 'admin' role to 'super', since 'admin' already
				// means an organization-member role (member.role) elsewhere in this codebase.
				roles: { user: userAc, super: adminAc },
			}),
			organization({
				invitationExpiresIn: 60 * 60 * 24 * 7,
				allowUserToCreateOrganization: false,
				organizationHooks: {
					beforeAddMember: async ({ member }) => assertOrganizationRole(member.role),
					beforeUpdateMemberRole: async ({ newRole }) => assertOrganizationRole(newRole),
					beforeCreateInvitation: async ({ invitation }) => assertOrganizationRole(invitation.role),
					afterCancelInvitation: async ({ invitation: inv }) => {
						await db.delete(invitation).where(eq(invitation.id, inv.id))
					},
					afterRejectInvitation: async ({ invitation: inv }) => {
						await db.delete(invitation).where(eq(invitation.id, inv.id))
					},
				},
				sendInvitationEmail: async ({ email, organization, inviter, role }) => {
					await sendInvitationEmail({
						email,
						organizationName: organization.name,
						inviterName: inviter.user.name || inviter.user.email,
						role,
					})
				},
			}),
		],
	})
}

export async function canSignUpWithEmail(email: string) {
	const normalizedEmail = email.toLowerCase()

	if (isBootstrapSuperadminEmail(normalizedEmail)) {
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

// Accounts that bypass email confirmation and are signed in immediately: the configured
// superadmin (whose initial sign-up happens right after env creation, before any mailbox
// exists to confirm) and @adomata.com staff accounts, which are trusted by domain.
export function skipsEmailVerification(email: string) {
	return isBootstrapSuperadminEmail(email) || isAdomataEmail(email)
}

export const requireAuth = createMiddleware(async (c, next) => {
	const session = (await createAuth().api.getSession({
		headers: c.req.raw.headers,
	})) as AuthSession | null

	if (!session) return apiError(c, 'UNAUTHORIZED')
	const activeAgencyId = await restoreActiveAgency(session.session, session.user.role)
	if (activeAgencyId) session.session.activeOrganizationId = activeAgencyId

	c.set('authSession', session)

	return next()
})

export const requireVerifiedAuth = createMiddleware(async (c, next) => {
	const authSession = c.get('authSession')
	if (!authSession.user.emailVerified) {
		return apiError(c, 'FORBIDDEN', { message: 'Потрібне підтвердження електронної пошти' })
	}

	return next()
})

export const requireOrg = createMiddleware(async (c, next) => {
	const authSession = c.get('authSession')
	const agencyId = authSession.session.activeOrganizationId
	if (!agencyId) return apiError(c, 'NO_ACTIVE_ORGANIZATION', { message: 'Немає активної агенції' })

	const [member] = await db
		.select({
			id: schema.member.id,
			organizationId: schema.member.organizationId,
			userId: schema.member.userId,
			role: schema.member.role,
		})
		.from(schema.member)
		.where(and(eq(schema.member.organizationId, agencyId), eq(schema.member.userId, authSession.user.id)))
		.limit(1)
	if (!member) return apiError(c, 'NO_ACTIVE_ORGANIZATION', { message: 'Немає активної агенції' })

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
