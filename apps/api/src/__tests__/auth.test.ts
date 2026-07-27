import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbCalls = vi.hoisted(() => ({
	selectResult: [] as Array<{ organizationId: string }>,
	updateSet: vi.fn(),
}))

vi.mock('../db', () => ({
	db: {
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
	},
}))

describe('restoreActiveAgency', () => {
	beforeEach(() => {
		dbCalls.selectResult = []
		dbCalls.updateSet.mockReset()
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
		dbCalls.selectResult = [{ organizationId: 'org_1' }]
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
		dbCalls.selectResult = []
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
})
