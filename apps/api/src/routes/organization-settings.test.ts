import { createMiddleware } from 'hono/factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiErrorSchema } from '../client/error'
import { organizationSettingsResponseSchema } from '../client/organization-settings'
import { MetaApiError } from '../meta/client'

const dbCalls = vi.hoisted(() => ({
	selectLimit: vi.fn(),
	insertValues: vi.fn(),
	insertOnConflictDoUpdate: vi.fn(),
	insertReturning: vi.fn(),
}))

const metaCalls = vi.hoisted(() => ({ verifyToken: vi.fn(), buildMetaClient: vi.fn() }))

vi.mock('../db', () => ({
	db: {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: dbCalls.selectLimit,
				})),
			})),
		})),
		insert: vi.fn(() => ({
			values: (...args: unknown[]) => {
				dbCalls.insertValues(...args)
				return {
					onConflictDoUpdate: (...conflictArgs: unknown[]) => {
						dbCalls.insertOnConflictDoUpdate(...conflictArgs)
						return { returning: dbCalls.insertReturning }
					},
				}
			},
		})),
	},
}))

vi.mock('../sync/runtime', () => ({
	getHeartbeatDependencies: () => ({
		heartbeatSecret: 'secret',
		metaMode: 'live' as const,
		buildMetaClient: metaCalls.buildMetaClient,
	}),
}))

vi.mock('../logic/auth', () => ({
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
				email: 'owner@example.com',
				emailVerified: true,
				role: 'user' as const,
				name: 'Test User',
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		})
		return next()
	}),
	requireVerifiedAuth: createMiddleware(async (_c, next) => next()),
	requireOrg: createMiddleware(async (c, next) => {
		c.set('orgId', 'org_1')
		c.set('orgMember', {
			id: 'member_1',
			organizationId: 'org_1',
			userId: 'user_1',
			role: (c.req.header('x-test-role') ?? 'owner') as 'owner' | 'admin' | 'member',
		})
		return next()
	}),
	isOwner: (member: { role: string }) => member.role === 'owner',
}))

beforeEach(() => {
	dbCalls.selectLimit.mockReset()
	dbCalls.insertValues.mockReset()
	dbCalls.insertOnConflictDoUpdate.mockReset()
	dbCalls.insertReturning.mockReset()
	metaCalls.verifyToken.mockReset()
	metaCalls.buildMetaClient.mockReset()
	metaCalls.buildMetaClient.mockReturnValue({ verifyToken: metaCalls.verifyToken })
})

describe('GET /organization-settings', () => {
	it('rejects a non-owner member', async () => {
		const { app } = await import('../app')

		const res = await app.request('/organization-settings', { headers: { 'x-test-role': 'admin' } })

		expect(res.status).toBe(403)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('FORBIDDEN')
		expect(dbCalls.selectLimit).not.toHaveBeenCalled()
	})

	it('returns hasToken: false when no row exists for the Agency', async () => {
		dbCalls.selectLimit.mockResolvedValue([])
		const { app } = await import('../app')

		const res = await app.request('/organization-settings')

		expect(res.status).toBe(200)
		const body = organizationSettingsResponseSchema.parse(await res.json())
		expect(body).toEqual({ hasToken: false, updatedAt: null, lastValidatedAt: null })
	})

	it('never returns the raw token, only the write-only shape', async () => {
		dbCalls.selectLimit.mockResolvedValue([
			{
				id: 'settings_1',
				organizationId: 'org_1',
				metaAccessToken: 'super-secret-token',
				updatedAt: new Date('2026-07-20T00:00:00.000Z'),
				lastValidatedAt: new Date('2026-07-20T00:00:00.000Z'),
			},
		])
		const { app } = await import('../app')

		const res = await app.request('/organization-settings')

		expect(res.status).toBe(200)
		const rawBody = await res.text()
		expect(rawBody).not.toContain('super-secret-token')
		expect(JSON.parse(rawBody)).toEqual({
			hasToken: true,
			updatedAt: '2026-07-20T00:00:00.000Z',
			lastValidatedAt: '2026-07-20T00:00:00.000Z',
		})
	})
})

describe('PUT /organization-settings', () => {
	it('rejects a non-owner member without validating a token', async () => {
		const { app } = await import('../app')

		const res = await app.request('/organization-settings', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', 'x-test-role': 'member' },
			body: JSON.stringify({ metaAccessToken: 'a-token' }),
		})

		expect(res.status).toBe(403)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('FORBIDDEN')
		expect(metaCalls.verifyToken).not.toHaveBeenCalled()
		expect(dbCalls.insertValues).not.toHaveBeenCalled()
	})

	it('rejects an invalid token without persisting it', async () => {
		metaCalls.verifyToken.mockRejectedValue(new MetaApiError('Invalid OAuth access token', 401, 190))
		const { app } = await import('../app')

		const res = await app.request('/organization-settings', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ metaAccessToken: 'a-bad-token' }),
		})

		expect(res.status).toBe(400)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('BAD_REQUEST')
		expect(dbCalls.insertValues).not.toHaveBeenCalled()
	})

	it('validates, then saves the token for the owner', async () => {
		metaCalls.verifyToken.mockResolvedValue({ id: 'meta-user', name: 'Meta User' })
		dbCalls.insertReturning.mockResolvedValue([
			{
				id: 'settings_1',
				organizationId: 'org_1',
				metaAccessToken: 'a-good-token',
				updatedAt: new Date('2026-07-28T00:00:00.000Z'),
				lastValidatedAt: new Date('2026-07-28T00:00:00.000Z'),
			},
		])
		const { app } = await import('../app')

		const res = await app.request('/organization-settings', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ metaAccessToken: 'a-good-token' }),
		})

		expect(res.status).toBe(200)
		const body = organizationSettingsResponseSchema.parse(await res.json())
		expect(body).toEqual({
			hasToken: true,
			updatedAt: new Date('2026-07-28T00:00:00.000Z'),
			lastValidatedAt: new Date('2026-07-28T00:00:00.000Z'),
		})
		expect(metaCalls.buildMetaClient).toHaveBeenCalledWith('a-good-token')
		expect(dbCalls.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: 'org_1', metaAccessToken: 'a-good-token' }),
		)
	})
})
