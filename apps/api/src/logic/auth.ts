import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins/bearer'
import { organization } from 'better-auth/plugins/organization'
import { and, eq, gt } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'

import { createDb } from '../db'
import * as schema from '../db/schema'
import { invitation, member, sessions } from '../db/schema'
import { apiError } from './apiError'
import type { Bindings } from '../index'

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

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, char => {
		switch (char) {
			case '&':
				return '&amp;'
			case '<':
				return '&lt;'
			case '>':
				return '&gt;'
			case '"':
				return '&quot;'
			case "'":
				return '&#39;'
			default:
				return char
		}
	})
}

function createInvitationUrl(env: Env, invitationId: string) {
	const baseUrl = env.BETTER_AUTH_URL ?? env.BASE_URL
	return `${baseUrl}/invitation/accept?id=${encodeURIComponent(invitationId)}`
}

export async function restoreActiveOrganization(
	env: Env,
	session: { token: string; userId: string; activeOrganizationId?: string | null },
) {
	if (session.activeOrganizationId) return
	const db = createDb(env.DB)
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

export function createAuth(env: Env) {
	return betterAuth({
		baseURL: env.BETTER_AUTH_URL,
		basePath: '/auth',
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(createDb(env.DB), {
			provider: 'sqlite',
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
				env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
					? {
							clientId: env.GOOGLE_CLIENT_ID,
							clientSecret: env.GOOGLE_CLIENT_SECRET,
						}
					: undefined,
			apple:
				env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
					? {
							clientId: env.APPLE_CLIENT_ID,
							clientSecret: env.APPLE_CLIENT_SECRET,
						}
					: undefined,
		},
		databaseHooks: {
			user: {
				create: {
					before: async user => {
						if (!(await canSignUpWithEmail(env, user.email))) {
							return false
						}
					},
				},
			},
			session: {
				create: {
					after: async session => restoreActiveOrganization(env, session),
				},
			},
		},
		plugins: [
			bearer(),
			organization({
				invitationExpiresIn: 60 * 60 * 24 * 7,
				allowUserToCreateOrganization: false,
				sendInvitationEmail: async ({ email, id, organization, inviter, role }) => {
					if (!env.EMAIL) throw new Error('EMAIL binding is not configured')
					if (!env.EMAIL_FROM) throw new Error('EMAIL_FROM is not configured')

					const invitationUrl = createInvitationUrl(env, id)
					const organizationName = organization.name
					const inviterName = inviter.user.name || inviter.user.email
					const subject = `Invitation to join ${organizationName}`
					const text = [
						`${inviterName} invited you to join ${organizationName} as ${role}.`,
						'',
						`Accept the invitation: ${invitationUrl}`,
						'',
						'This invitation expires in 7 days.',
					].join('\n')

					await env.EMAIL.send({
						to: email,
						from: env.EMAIL_FROM,
						subject,
						text,
						html: [
							`<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(organizationName)}</strong> as ${escapeHtml(role)}.</p>`,
							`<p><a href="${escapeHtml(invitationUrl)}">Accept the invitation</a></p>`,
							'<p>This invitation expires in 7 days.</p>',
						].join(''),
					})
				},
			}),
		],
	})
}

export async function canSignUpWithEmail(env: Env, email: string) {
	const normalizedEmail = email.toLowerCase()

	if (env.SUPERADMIN_EMAIL && normalizedEmail === env.SUPERADMIN_EMAIL.toLowerCase()) {
		return true
	}

	const pendingInvitation = await createDb(env.DB)
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

export async function activateInvitedOrganization(env: Env, email: string, sessionToken: string) {
	const normalizedEmail = email.toLowerCase()
	const db = createDb(env.DB)
	const [pendingInvitation] = await db
		.select({ organizationId: invitation.organizationId })
		.from(invitation)
		.where(
			and(
				eq(invitation.email, normalizedEmail),
				eq(invitation.status, 'pending'),
				gt(invitation.expiresAt, new Date()),
			),
		)
		.limit(1)

	if (!pendingInvitation) return

	await db
		.update(sessions)
		.set({ activeOrganizationId: pendingInvitation.organizationId })
		.where(eq(sessions.token, sessionToken))
}

export const requireAuth = createMiddleware<Bindings>(async (c, next) => {
	const session = (await createAuth(c.env).api.getSession({
		headers: c.req.raw.headers,
	})) as AuthSession | null

	if (!session) return apiError(c, 'UNAUTHORIZED')

	c.set('authSession', session)

	return next()
})

export const requireOrg = createMiddleware<Bindings>(async (c, next) => {
	let member: OrgMember | null = null

	try {
		member = (await createAuth(c.env).api.getActiveMember({
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
