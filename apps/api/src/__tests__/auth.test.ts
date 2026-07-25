import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbCalls = vi.hoisted(() => ({
	selectResult: [] as Array<{ organizationId: string }>,
	updateSet: vi.fn(),
}))

vi.mock('../db', () => ({
	createDb: vi.fn(() => ({
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn(async () => dbCalls.selectResult),
				})),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn(value => ({
				where: vi.fn(async () => {
					dbCalls.updateSet(value)
				}),
			})),
		})),
	})),
}))

describe('restoreActiveOrganization', () => {
	beforeEach(() => {
		dbCalls.selectResult = []
		dbCalls.updateSet.mockReset()
	})

	it('skips when session already has an active organization', async () => {
		const { restoreActiveOrganization } = await import('../logic/auth')

		await restoreActiveOrganization({} as Env, {
			token: 'tok_1',
			userId: 'user_1',
			activeOrganizationId: 'org_1',
		})

		expect(dbCalls.updateSet).not.toHaveBeenCalled()
	})

	it('sets activeOrganizationId from the user membership on sign-in', async () => {
		dbCalls.selectResult = [{ organizationId: 'org_1' }]
		const { restoreActiveOrganization } = await import('../logic/auth')

		await restoreActiveOrganization({} as Env, {
			token: 'tok_1',
			userId: 'user_1',
		})

		expect(dbCalls.updateSet).toHaveBeenCalledWith({ activeOrganizationId: 'org_1' })
	})

	it('does nothing when the user has no memberships', async () => {
		dbCalls.selectResult = []
		const { restoreActiveOrganization } = await import('../logic/auth')

		await restoreActiveOrganization({} as Env, {
			token: 'tok_1',
			userId: 'user_1',
		})

		expect(dbCalls.updateSet).not.toHaveBeenCalled()
	})
})
