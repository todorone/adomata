import { createMiddleware } from 'hono/factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { meResponseSchema } from '../client/me'

const authCalls = vi.hoisted(() => ({
	getActiveMember: vi.fn(),
}))

const dbCalls = vi.hoisted(() => ({
	memberships: [] as Array<{ id: string; name: string; slug: string | null; logo: string | null; role: string }>,
	activeMember: null as { id: string; organizationId: string; userId: string; role: string } | null,
}))

vi.mock('../db', () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					where: vi.fn(() => ({ orderBy: vi.fn(() => dbCalls.memberships) })),
				})),
				where: vi.fn(() => ({
					limit: vi.fn(() => (dbCalls.activeMember ? [dbCalls.activeMember] : [])),
				})),
			})),
		})),
	},
}))

vi.mock('../logic/auth', () => ({
	canSignUpWithEmail: vi.fn(),
	createAuth: vi.fn(() => ({
		api: {
			getActiveMember: authCalls.getActiveMember,
		},
	})),
	requireAuth: createMiddleware(async (c, next) => {
		c.set('authSession', {
			session: {
				id: 'session_1',
				token: 'token_1',
				userId: 'user_1',
				expiresAt: new Date('2026-01-01T00:00:00.000Z'),
				createdAt: new Date('2025-01-01T00:00:00.000Z'),
				updatedAt: new Date('2025-01-02T00:00:00.000Z'),
				activeOrganizationId: 'org_1',
			},
			user: {
				id: 'user_1',
				email: 'user@example.com',
				emailVerified: true,
				name: 'Test User',
				createdAt: new Date('2025-01-01T00:00:00.000Z'),
				updatedAt: new Date('2025-01-02T00:00:00.000Z'),
			},
		})

		return next()
	}),
	requireOrg: createMiddleware(async (_c, next) => next()),
}))

describe('GET /me', () => {
	beforeEach(() => {
		authCalls.getActiveMember.mockReset()
		dbCalls.memberships = []
		dbCalls.activeMember = null
	})

	it('includes the active organization membership', async () => {
		dbCalls.activeMember = {
			id: 'member_1',
			organizationId: 'org_1',
			userId: 'user_1',
			role: 'admin',
		}
		dbCalls.memberships = [
			{
				id: 'org_1',
				name: 'Acme Ops',
				slug: 'acme-ops',
				logo: null,
				role: 'admin',
			},
		]
		const { app } = await import('../app')

		const res = await app.request('/me')

		expect(res.status).toBe(200)
		const body = await res.json()
		const parsed = meResponseSchema.parse(body)
		expect(parsed).toMatchObject({
			session: {
				id: 'session_1',
				activeOrganizationId: 'org_1',
			},
			user: {
				id: 'user_1',
				email: 'user@example.com',
			},
			activeOrgMember: {
				id: 'member_1',
				organizationId: 'org_1',
				userId: 'user_1',
				role: 'admin',
			},
			activeOrganization: {
				id: 'org_1',
				name: 'Acme Ops',
				slug: 'acme-ops',
				logo: null,
			},
			memberships: [{ id: 'org_1', name: 'Acme Ops', slug: 'acme-ops', logo: null, role: 'admin' }],
			isSuperadmin: false,
		})
		expect(body).toEqual({
			session: {
				id: 'session_1',
				token: 'token_1',
				userId: 'user_1',
				expiresAt: '2026-01-01T00:00:00.000Z',
				createdAt: '2025-01-01T00:00:00.000Z',
				updatedAt: '2025-01-02T00:00:00.000Z',
				activeOrganizationId: 'org_1',
			},
			user: {
				id: 'user_1',
				email: 'user@example.com',
				emailVerified: true,
				name: 'Test User',
				createdAt: '2025-01-01T00:00:00.000Z',
				updatedAt: '2025-01-02T00:00:00.000Z',
			},
			activeOrgMember: {
				id: 'member_1',
				organizationId: 'org_1',
				userId: 'user_1',
				role: 'admin',
			},
			activeOrganization: {
				id: 'org_1',
				name: 'Acme Ops',
				slug: 'acme-ops',
				logo: null,
			},
			memberships: [{ id: 'org_1', name: 'Acme Ops', slug: 'acme-ops', logo: null, role: 'admin' }],
			isSuperadmin: false,
		})
	})
})
