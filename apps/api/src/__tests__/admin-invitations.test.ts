import { createMiddleware } from 'hono/factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adminInvitationsResponseSchema } from '../client/admin/invitations'
import { apiErrorSchema } from '../client/error'

const dbCalls = vi.hoisted(() => ({
	rows: [] as Array<Record<string, unknown>>,
}))

vi.mock('../db', () => ({
	createDb: vi.fn(() => ({
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					orderBy: vi.fn(async () => dbCalls.rows),
				})),
			})),
		})),
	})),
}))

vi.mock('../logic/auth', () => ({
	canSignUpWithEmail: vi.fn(),
	createAuth: vi.fn(() => ({ api: {} })),
	requireAuth: createMiddleware(async (c, next) => {
		c.set('authSession', {
			session: {
				id: 'session_1',
				token: 'token_1',
				userId: 'user_1',
				expiresAt: new Date(),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			user: {
				id: 'user_1',
				email: c.req.header('x-test-user-email') ?? 'member@example.com',
				emailVerified: true,
				name: 'Test User',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		})
		return next()
	}),
	requireOrg: createMiddleware(async (_c, next) => next()),
}))

const now = new Date('2025-06-01T00:00:00.000Z')
const expires = new Date('2025-06-08T00:00:00.000Z')

const sampleRow = {
	id: 'inv_1',
	organizationId: 'org_1',
	organizationName: 'Acme',
	email: 'worker@example.com',
	role: 'member',
	status: 'pending',
	expiresAt: expires,
	createdAt: now,
	inviterId: 'user_1',
}

describe('GET /admin/invitations', () => {
	beforeEach(() => {
		dbCalls.rows = []
		vi.resetModules()
	})

	it('rejects non-superadmin callers', async () => {
		const { default: app } = await import('../index')

		const res = await app.request(
			'/admin/invitations',
			{ headers: { 'x-test-user-email': 'member@example.com' } },
			{ SUPERADMIN_EMAIL: 'admin@example.com' },
		)

		expect(res.status).toBe(403)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('FORBIDDEN')
	})

	it('returns all invitations with organization names for the superadmin', async () => {
		dbCalls.rows = [sampleRow]
		const { default: app } = await import('../index')

		const res = await app.request(
			'/admin/invitations',
			{ headers: { 'x-test-user-email': 'admin@example.com' } },
			{ SUPERADMIN_EMAIL: 'admin@example.com' },
		)

		expect(res.status).toBe(200)
		const body = await res.json()
		const parsed = adminInvitationsResponseSchema.parse(body)
		expect(parsed.invitations).toHaveLength(1)
		expect(parsed.invitations[0]).toMatchObject({
			id: 'inv_1',
			organizationId: 'org_1',
			organizationName: 'Acme',
			email: 'worker@example.com',
			role: 'member',
			status: 'pending',
			inviterId: 'user_1',
		})
	})

	it('returns an empty list when there are no invitations', async () => {
		dbCalls.rows = []
		const { default: app } = await import('../index')

		const res = await app.request(
			'/admin/invitations',
			{ headers: { 'x-test-user-email': 'admin@example.com' } },
			{ SUPERADMIN_EMAIL: 'admin@example.com' },
		)

		expect(res.status).toBe(200)
		const body = await res.json()
		const parsed = adminInvitationsResponseSchema.parse(body)
		expect(parsed.invitations).toHaveLength(0)
	})
})
