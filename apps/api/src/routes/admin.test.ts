import { createMiddleware } from 'hono/factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiErrorSchema } from '../client/error'
import { resendInvitationResponseSchema } from '../client/admin/invitations'

const dbCalls = vi.hoisted(() => ({
	selectResults: [] as Array<Array<Record<string, unknown>>>,
	updateSet: vi.fn(),
	updateReturning: [] as Array<Record<string, unknown>>,
}))

const emailCalls = vi.hoisted(() => ({ sendInvitationEmail: vi.fn() }))

function selectChain(rows: Array<Record<string, unknown>>) {
	const chain: Record<string, unknown> = {}
	for (const method of ['from', 'innerJoin', 'where', 'orderBy']) {
		chain[method] = vi.fn(() => chain)
	}
	chain.limit = vi.fn(async () => rows)
	return chain
}

vi.mock('../db', () => ({
	db: {
		select: vi.fn(() => selectChain(dbCalls.selectResults.shift() ?? [])),
		update: vi.fn(() => ({
			set: vi.fn((value: unknown) => {
				dbCalls.updateSet(value)
				return { where: vi.fn(() => ({ returning: vi.fn(async () => dbCalls.updateReturning) })) }
			}),
		})),
	},
}))

vi.mock('../logic/email', () => emailCalls)

vi.mock('../logic/auth', () => ({
	canSignUpWithEmail: vi.fn(),
	createAuth: vi.fn(),
	isOwner: vi.fn(),
	requireOrg: createMiddleware(async (_c, next) => next()),
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
				email: 'admin@example.com',
				emailVerified: true,
				role: (c.req.header('x-test-role') ?? 'super') as 'user' | 'super',
				name: 'Admin',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		})
		return next()
	}),
	requireVerifiedAuth: createMiddleware(async (_c, next) => next()),
}))

beforeEach(() => {
	dbCalls.selectResults = []
	dbCalls.updateSet.mockReset()
	dbCalls.updateReturning = []
	emailCalls.sendInvitationEmail.mockReset()
})

describe('POST /admin/invitations/:id/resend', () => {
	it('rejects a non-superadmin caller', async () => {
		const { app } = await import('../app')

		const res = await app.request('/admin/invitations/inv_1/resend', {
			method: 'POST',
			headers: { 'x-test-role': 'user' },
		})

		expect(res.status).toBe(403)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('FORBIDDEN')
		expect(emailCalls.sendInvitationEmail).not.toHaveBeenCalled()
	})

	it('404s when the invitation does not exist', async () => {
		dbCalls.selectResults = [[]]
		const { app } = await import('../app')

		const res = await app.request('/admin/invitations/inv_missing/resend', { method: 'POST' })

		expect(res.status).toBe(404)
		expect(emailCalls.sendInvitationEmail).not.toHaveBeenCalled()
	})

	it('rejects resending a non-pending invitation', async () => {
		dbCalls.selectResults = [
			[
				{
					id: 'inv_1',
					organizationId: 'org_1',
					organizationName: 'Acme',
					email: 'invitee@example.com',
					role: 'member',
					status: 'accepted',
					expiresAt: new Date(),
					createdAt: new Date(),
					inviterId: 'user_2',
					inviterName: 'Inviter',
					inviterEmail: 'inviter@example.com',
				},
			],
		]
		const { app } = await import('../app')

		const res = await app.request('/admin/invitations/inv_1/resend', { method: 'POST' })

		expect(res.status).toBe(400)
		expect(emailCalls.sendInvitationEmail).not.toHaveBeenCalled()
	})

	it('allows resending the same invitation repeatedly (no cap)', async () => {
		const row = {
			id: 'inv_1',
			organizationId: 'org_1',
			organizationName: 'Acme',
			email: 'invitee@example.com',
			role: 'member',
			status: 'pending',
			expiresAt: new Date(),
			createdAt: new Date(),
			inviterId: 'user_2',
			inviterName: 'Inviter',
			inviterEmail: 'inviter@example.com',
		}
		dbCalls.selectResults = [[row], [row]]
		dbCalls.updateReturning = [
			{
				id: 'inv_1',
				organizationId: 'org_1',
				email: 'invitee@example.com',
				role: 'member',
				status: 'pending',
				expiresAt: new Date(),
				createdAt: new Date(),
				inviterId: 'user_2',
			},
		]
		const { app } = await import('../app')

		const first = await app.request('/admin/invitations/inv_1/resend', { method: 'POST' })
		const second = await app.request('/admin/invitations/inv_1/resend', { method: 'POST' })

		expect(first.status).toBe(200)
		expect(second.status).toBe(200)
		expect(emailCalls.sendInvitationEmail).toHaveBeenCalledTimes(2)
	})

	it('resends the email and extends expiresAt', async () => {
		dbCalls.selectResults = [
			[
				{
					id: 'inv_1',
					organizationId: 'org_1',
					organizationName: 'Acme',
					email: 'invitee@example.com',
					role: 'member',
					status: 'pending',
					expiresAt: new Date('2026-01-01T00:00:00.000Z'),
					createdAt: new Date('2026-01-01T00:00:00.000Z'),
					inviterId: 'user_2',
					inviterName: 'Inviter',
					inviterEmail: 'inviter@example.com',
				},
			],
		]
		const newExpiresAt = new Date('2026-02-01T00:00:00.000Z')
		dbCalls.updateReturning = [
			{
				id: 'inv_1',
				organizationId: 'org_1',
				email: 'invitee@example.com',
				role: 'member',
				status: 'pending',
				expiresAt: newExpiresAt,
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				inviterId: 'user_2',
			},
		]
		const { app } = await import('../app')

		const res = await app.request('/admin/invitations/inv_1/resend', { method: 'POST' })

		expect(res.status).toBe(200)
		const body = resendInvitationResponseSchema.parse(await res.json())
		expect(body.invitation.expiresAt).toEqual(newExpiresAt)
		expect(emailCalls.sendInvitationEmail).toHaveBeenCalledWith({
			email: 'invitee@example.com',
			organizationName: 'Acme',
			inviterName: 'Inviter',
			role: 'member',
		})
		expect(dbCalls.updateSet).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: expect.any(Date) }))
	})
})
