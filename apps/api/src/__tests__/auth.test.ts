import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SessionCreateHookOptions = {
	databaseHooks: {
		session: {
			create: {
				after: (session: { token: string; userId: string }) => Promise<void>
			}
		}
	}
	emailVerification: {
		autoSignInAfterVerification?: boolean
		expiresIn?: number
	}
	trustedOrigins: (request?: Request) => string[]
}

const dbCalls = vi.hoisted(() => ({
	selectResults: [] as Array<Array<Record<string, unknown>>>,
	updateSet: vi.fn(),
}))

const authCalls = vi.hoisted(() => ({
	acceptInvitation: vi.fn(),
	options: undefined as SessionCreateHookOptions | undefined,
}))

vi.mock('../db', () => ({
	db: {
		select: vi.fn(() => {
			const rows = dbCalls.selectResults.shift() ?? []
			const query = { limit: vi.fn(async () => rows) }
			return {
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => query),
						...query,
					})),
				})),
			}
		}),
		update: vi.fn(() => ({
			set: vi.fn(value => ({
				where: vi.fn(async () => {
					dbCalls.updateSet(value)
				}),
			})),
		})),
	},
}))

vi.mock('@better-auth/drizzle-adapter', () => ({
	drizzleAdapter: vi.fn(() => ({})),
}))

vi.mock('better-auth', async importOriginal => ({
	...(await importOriginal<typeof import('better-auth')>()),
	betterAuth: vi.fn((options: SessionCreateHookOptions) => {
		authCalls.options = options
		return { api: { acceptInvitation: authCalls.acceptInvitation } }
	}),
}))

describe('restoreActiveAgency', () => {
	beforeEach(() => {
		dbCalls.selectResults = []
		dbCalls.updateSet.mockReset()
		authCalls.acceptInvitation.mockReset()
		authCalls.options = undefined
	})

	it('skips when session already has an active organization', async () => {
		const { restoreActiveAgency } = await import('../logic/activeAgency')

		await restoreActiveAgency(
			{
				token: 'tok_1',
				userId: 'user_1',
				activeOrganizationId: 'org_1',
			},
			'user@example.com',
		)

		expect(dbCalls.updateSet).not.toHaveBeenCalled()
	})

	it('sets activeOrganizationId from the user membership on sign-in', async () => {
		dbCalls.selectResults = [[{ organizationId: 'org_1' }]]
		const { restoreActiveAgency } = await import('../logic/activeAgency')

		await restoreActiveAgency(
			{
				token: 'tok_1',
				userId: 'user_1',
			},
			'user@example.com',
		)

		expect(dbCalls.updateSet).toHaveBeenCalledWith({ activeOrganizationId: 'org_1' })
	})

	it('does nothing when the user has no memberships', async () => {
		dbCalls.selectResults = [[]]
		const { restoreActiveAgency } = await import('../logic/activeAgency')

		await restoreActiveAgency(
			{
				token: 'tok_1',
				userId: 'user_1',
			},
			'user@example.com',
		)

		expect(dbCalls.updateSet).not.toHaveBeenCalled()
	})

	it('accepts a pending invitation on the first verified session', async () => {
		dbCalls.selectResults = [
			[{ email: 'invited@example.com', emailVerified: true, role: 'user' }],
			[],
			[{ id: 'inv_1', organizationId: 'org_1' }],
		]
		const { createAuth } = await import('../logic/auth')

		createAuth()
		const afterSessionCreated = authCalls.options?.databaseHooks.session.create.after
		expect(afterSessionCreated).toBeDefined()
		await afterSessionCreated!({ token: 'tok_1', userId: 'user_1' })

		expect(authCalls.acceptInvitation).toHaveBeenCalledWith({
			body: { invitationId: 'inv_1' },
			headers: expect.any(Headers),
		})
		const [{ headers }] = authCalls.acceptInvitation.mock.calls[0]
		expect(headers.get('authorization')).toBe('Bearer tok_1')
		expect(dbCalls.updateSet).toHaveBeenCalledWith({ activeOrganizationId: 'org_1' })
	})
})

describe('createAuth email verification config', () => {
	const originalClientUrl = process.env.CLIENT_URL

	beforeEach(() => {
		authCalls.options = undefined
		process.env.CLIENT_URL = 'http://localhost:5173'
	})

	afterEach(() => {
		if (originalClientUrl === undefined) delete process.env.CLIENT_URL
		else process.env.CLIENT_URL = originalClientUrl
	})

	it('signs the user in on verification, with a short-lived token', async () => {
		const { createAuth } = await import('../logic/auth')

		createAuth()

		expect(authCalls.options?.emailVerification.autoSignInAfterVerification).toBe(true)
		expect(authCalls.options?.emailVerification.expiresIn).toBe(60 * 30)
	})

	it('trusts CLIENT_URL as a verify-email callback target even without a request Origin header', async () => {
		const { createAuth } = await import('../logic/auth')

		createAuth()

		expect(authCalls.options?.trustedOrigins(undefined)).toContain('http://localhost:5173')
	})
})
