import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMiddleware } from 'hono/factory'

import { apiErrorSchema } from '../client/error'

const wipeDatabase = vi.fn(async () => {})

vi.mock('../db/wipe', () => ({ wipeDatabase }))
vi.mock('../db', () => ({
	db: {
		delete: vi.fn(() => ({ where: vi.fn() })),
		select: vi.fn(() => ({ from: vi.fn() })),
	},
}))
vi.mock('../logic/auth', () => ({
	canSignUpWithEmail: vi.fn(),
	createAuth: vi.fn(),
	requireAuth: createMiddleware(async (c, next) => {
		const email = c.req.header('x-test-user-email')
		if (!email) return c.json({ error: { code: 'UNAUTHORIZED' } }, 401)

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
				email,
				emailVerified: c.req.header('x-test-email-verified') !== 'false',
				name: 'Test User',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		})

		return next()
	}),
	requireOrg: createMiddleware(async (_c, next) => next()),
}))

const { app } = await import('../app')

describe('DELETE /admin/database', () => {
	beforeEach(() => {
		process.env.SUPERADMIN_EMAIL = 'admin@example.com'
		wipeDatabase.mockReset()
		wipeDatabase.mockResolvedValue(undefined)
	})

	afterEach(() => {
		delete process.env.SUPERADMIN_EMAIL
	})

	it('requires authentication', async () => {
		const res = await app.request('/admin/database', { method: 'DELETE' })

		expect(res.status).toBe(401)
		expect(wipeDatabase).not.toHaveBeenCalled()
	})

	it('rejects non-superadmin and unverified callers', async () => {
		const rejectedRequests: Record<string, string>[] = [
			{ 'x-test-user-email': 'member@example.com' },
			{ 'x-test-user-email': 'admin@example.com', 'x-test-email-verified': 'false' },
		]
		for (const headers of rejectedRequests) {
			const res = await app.request('/admin/database', { method: 'DELETE', headers })

			expect(res.status).toBe(403)
			expect(apiErrorSchema.parse(await res.json()).error.code).toBe('FORBIDDEN')
		}
		expect(wipeDatabase).not.toHaveBeenCalled()
	})

	it('wipes every table for a verified superadmin', async () => {
		const res = await app.request('/admin/database', {
			method: 'DELETE',
			headers: { 'x-test-user-email': 'admin@example.com' },
		})

		expect(res.status).toBe(204)
		expect(wipeDatabase).toHaveBeenCalledOnce()
	})
})
