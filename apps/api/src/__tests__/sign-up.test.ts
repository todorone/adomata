import { createMiddleware } from 'hono/factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authCalls = vi.hoisted(() => ({
	activateInvitedOrganization: vi.fn(),
	canSignUpWithEmail: vi.fn(),
	handler: vi.fn(),
}))

// Not used directly by this route, but ../app transitively imports every route
// module (including routes/admin.ts, which imports ../db) to register them —
// mock it so the real Bun-only db/index.ts is never evaluated under Node.
vi.mock('../db', () => ({ db: {} }))

vi.mock('../logic/auth', () => ({
	activateInvitedOrganization: authCalls.activateInvitedOrganization,
	canSignUpWithEmail: authCalls.canSignUpWithEmail,
	createAuth: vi.fn(() => ({
		handler: authCalls.handler,
		api: {
			getActiveMember: vi.fn(),
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
				email: 'user@example.com',
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

describe('POST /auth/sign-up/email', () => {
	beforeEach(() => {
		authCalls.activateInvitedOrganization.mockReset()
		authCalls.canSignUpWithEmail.mockReset()
		authCalls.handler.mockReset()
		authCalls.handler.mockResolvedValue(
			Response.json({
				token: 'token_1',
				user: { id: 'user_1', email: 'invited@example.com', name: 'Invited User' },
			}),
		)
	})

	it('blocks sign-up without a pending invitation', async () => {
		authCalls.canSignUpWithEmail.mockResolvedValue(false)
		const { app } = await import('../app')

		const res = await app.request('/auth/sign-up/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: 'uninvited@example.com',
				password: 'password123',
				name: 'Eve',
			}),
		})

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'Registration requires an invitation' })
		expect(authCalls.canSignUpWithEmail).toHaveBeenCalledWith('uninvited@example.com')
		expect(authCalls.handler).not.toHaveBeenCalled()
	})

	it('forwards invited sign-ups to better-auth', async () => {
		authCalls.canSignUpWithEmail.mockResolvedValue(true)
		const { app } = await import('../app')

		const res = await app.request('/auth/sign-up/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: 'invited@example.com',
				password: 'password123',
				name: 'Invited User',
			}),
		})

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			token: 'token_1',
			user: { id: 'user_1', email: 'invited@example.com', name: 'Invited User' },
		})
		expect(authCalls.handler).toHaveBeenCalledOnce()
	})

	it('sets the invited organization as active after sign-up', async () => {
		authCalls.canSignUpWithEmail.mockResolvedValue(true)
		const { app } = await import('../app')

		const res = await app.request('/auth/sign-up/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: 'invited@example.com',
				password: 'password123',
				name: 'Invited User',
			}),
		})

		expect(res.status).toBe(200)
		expect(authCalls.activateInvitedOrganization).toHaveBeenCalledWith('invited@example.com', 'token_1')
	})
})
