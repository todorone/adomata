import { createMiddleware } from 'hono/factory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { adminOrganizationsResponseSchema, createAdminOrganizationResponseSchema } from '../client/admin/organizations'
import { apiErrorSchema } from '../client/error'

const authCalls = vi.hoisted(() => ({
	createOrganization: vi.fn(),
	createInvitation: vi.fn(),
	deleteWhere: vi.fn(),
	selectFrom: vi.fn(),
}))

const invitationCalls = vi.hoisted(() => ({
	acceptInvitationForExistingVerifiedUser: vi.fn(),
}))

const emailCalls = vi.hoisted(() => ({
	sendInvitationEmail: vi.fn(),
}))

vi.mock('../logic/invitation', () => ({
	acceptInvitationForExistingVerifiedUser: invitationCalls.acceptInvitationForExistingVerifiedUser,
}))

vi.mock('../logic/email', () => ({
	sendInvitationEmail: emailCalls.sendInvitationEmail,
}))

vi.mock('../logic/auth', () => ({
	canSignUpWithEmail: vi.fn(),
	createAuth: vi.fn(() => ({
		api: {
			createOrganization: authCalls.createOrganization,
			createInvitation: authCalls.createInvitation,
		},
	})),
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
	requireVerifiedAuth: createMiddleware(async (_c, next) => next()),
}))

vi.mock('../db', () => ({
	db: {
		delete: vi.fn(() => ({ where: authCalls.deleteWhere })),
		select: vi.fn(() => ({ from: authCalls.selectFrom })),
	},
}))

beforeEach(() => {
	process.env.SUPERADMIN_EMAIL = 'admin@example.com'
})

afterEach(() => {
	delete process.env.SUPERADMIN_EMAIL
})

describe('POST /admin/organizations', () => {
	beforeEach(() => {
		authCalls.createOrganization.mockReset()
		authCalls.createInvitation.mockReset()
		authCalls.deleteWhere.mockReset()
		authCalls.selectFrom.mockReset()
		invitationCalls.acceptInvitationForExistingVerifiedUser.mockReset()
		emailCalls.sendInvitationEmail.mockReset()
		authCalls.createOrganization.mockResolvedValue({
			id: 'org_1',
			name: 'Frontpeek',
			slug: 'frontpeek',
			logo: null,
		})
		authCalls.createInvitation.mockResolvedValue({ id: 'invitation_1' })
		invitationCalls.acceptInvitationForExistingVerifiedUser.mockResolvedValue(false)
		emailCalls.sendInvitationEmail.mockResolvedValue(undefined)
	})

	it('rejects non-superadmin callers', async () => {
		const { app } = await import('../app')

		const res = await app.request('/admin/organizations', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-test-user-email': 'member@example.com',
			},
			body: JSON.stringify({
				orgName: 'Frontpeek',
				orgSlug: 'frontpeek',
				firstOwnerEmail: 'owner@example.com',
			}),
		})

		expect(res.status).toBe(403)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('FORBIDDEN')
		expect(authCalls.createOrganization).not.toHaveBeenCalled()
		expect(authCalls.createInvitation).not.toHaveBeenCalled()
		expect(authCalls.deleteWhere).not.toHaveBeenCalled()
	})

	it('creates an organization and owner invitation for the superadmin', async () => {
		const { app } = await import('../app')

		const res = await app.request('/admin/organizations', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-test-user-email': 'admin@example.com',
			},
			body: JSON.stringify({
				orgName: 'Frontpeek',
				orgSlug: 'frontpeek',
				firstOwnerEmail: 'owner@example.com',
			}),
		})

		expect(res.status).toBe(201)
		const body = await res.json()
		expect(createAdminOrganizationResponseSchema.parse(body)).toEqual({
			org: {
				id: 'org_1',
				name: 'Frontpeek',
				slug: 'frontpeek',
				logo: null,
			},
			invitationId: 'invitation_1',
		})
		expect(body).toEqual({
			org: {
				id: 'org_1',
				name: 'Frontpeek',
				slug: 'frontpeek',
				logo: null,
			},
			invitationId: 'invitation_1',
		})
		expect(authCalls.createOrganization).toHaveBeenCalledWith({
			body: {
				name: 'Frontpeek',
				slug: 'frontpeek',
				userId: 'user_1',
			},
		})
		expect(authCalls.createInvitation).toHaveBeenCalledWith({
			body: {
				organizationId: 'org_1',
				email: 'owner@example.com',
				role: 'owner',
			},
			headers: expect.any(Headers),
		})
		expect(invitationCalls.acceptInvitationForExistingVerifiedUser).toHaveBeenCalledWith({ id: 'invitation_1' })
		expect(emailCalls.sendInvitationEmail).not.toHaveBeenCalled()
		expect(authCalls.deleteWhere).toHaveBeenCalledOnce()
	})

	it('keeps the superadmin as owner when they are the first owner', async () => {
		const { app } = await import('../app')

		const res = await app.request('/admin/organizations', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-test-user-email': 'ADMIN@example.com',
			},
			body: JSON.stringify({
				orgName: 'Adomata',
				orgSlug: 'adomata',
				firstOwnerEmail: 'admin@example.com',
			}),
		})

		expect(res.status).toBe(201)
		expect(authCalls.createInvitation).not.toHaveBeenCalled()
		expect(emailCalls.sendInvitationEmail).not.toHaveBeenCalled()
		expect(authCalls.deleteWhere).not.toHaveBeenCalled()
	})

	it('rejects invalid creation requests before creating an organization', async () => {
		const { app } = await import('../app')

		const res = await app.request('/admin/organizations', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-test-user-email': 'admin@example.com',
			},
			body: JSON.stringify({
				orgName: 'Frontpeek',
				orgSlug: 'frontpeek',
				firstOwnerEmail: 'not-an-email',
			}),
		})

		expect(res.status).toBe(400)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('BAD_REQUEST')
		expect(authCalls.createOrganization).not.toHaveBeenCalled()
		expect(authCalls.createInvitation).not.toHaveBeenCalled()
		expect(authCalls.deleteWhere).not.toHaveBeenCalled()
	})
})

describe('GET /admin/organizations', () => {
	beforeEach(() => {
		authCalls.selectFrom.mockReset()
		authCalls.selectFrom.mockResolvedValue([
			{ id: 'org_1', name: 'Frontpeek', slug: 'frontpeek', logo: null, createdAt: new Date('2024-01-01') },
			{ id: 'org_2', name: 'Acme', slug: 'acme', logo: null, createdAt: new Date('2024-02-01') },
		])
	})

	it('rejects non-superadmin callers', async () => {
		const { app } = await import('../app')

		const res = await app.request('/admin/organizations', {
			method: 'GET',
			headers: { 'x-test-user-email': 'member@example.com' },
		})

		expect(res.status).toBe(403)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('FORBIDDEN')
		expect(authCalls.selectFrom).not.toHaveBeenCalled()
	})

	it('returns the list of organizations for the superadmin', async () => {
		const { app } = await import('../app')

		const res = await app.request('/admin/organizations', {
			method: 'GET',
			headers: { 'x-test-user-email': 'admin@example.com' },
		})

		expect(res.status).toBe(200)
		const body = await res.json()
		const parsed = adminOrganizationsResponseSchema.parse(body)
		expect(parsed.organizations).toHaveLength(2)
		expect(body).toEqual({
			organizations: [
				{ id: 'org_1', name: 'Frontpeek', slug: 'frontpeek', logo: null, createdAt: '2024-01-01T00:00:00.000Z' },
				{ id: 'org_2', name: 'Acme', slug: 'acme', logo: null, createdAt: '2024-02-01T00:00:00.000Z' },
			],
		})
		expect(authCalls.selectFrom).toHaveBeenCalledOnce()
	})
})

describe('DELETE /admin/organizations/:id', () => {
	beforeEach(() => {
		authCalls.deleteWhere.mockReset()
		authCalls.deleteWhere.mockResolvedValue(undefined)
	})

	it('rejects non-superadmin callers', async () => {
		const { app } = await import('../app')

		const res = await app.request('/admin/organizations/org_1', {
			method: 'DELETE',
			headers: { 'x-test-user-email': 'member@example.com' },
		})

		expect(res.status).toBe(403)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('FORBIDDEN')
		expect(authCalls.deleteWhere).not.toHaveBeenCalled()
	})

	it('deletes the organization for the superadmin', async () => {
		const { app } = await import('../app')

		const res = await app.request('/admin/organizations/org_1', {
			method: 'DELETE',
			headers: { 'x-test-user-email': 'admin@example.com' },
		})

		expect(res.status).toBe(204)
		expect(authCalls.deleteWhere).toHaveBeenCalledOnce()
	})
})
