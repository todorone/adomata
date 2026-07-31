import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbCalls = vi.hoisted(() => ({
	selectResult: [] as Array<{ organizationId: string }>,
	updateSet: vi.fn(),
}))

const invitationCalls = vi.hoisted(() => ({
	acceptPendingInvitationForVerifiedSession: vi.fn(),
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

vi.mock('../logic/invitation', () => ({
	acceptPendingInvitationForVerifiedSession: invitationCalls.acceptPendingInvitationForVerifiedSession,
}))

describe('restoreActiveAgency', () => {
	beforeEach(() => {
		dbCalls.selectResult = []
		dbCalls.updateSet.mockReset()
		invitationCalls.acceptPendingInvitationForVerifiedSession.mockReset()
	})

	it('skips when session already has an active organization', async () => {
		const { restoreActiveAgency } = await import('../logic/activeAgency')

		await restoreActiveAgency(
			{
				token: 'tok_1',
				userId: 'user_1',
				activeOrganizationId: 'org_1',
			},
			{ email: 'user@example.com', emailVerified: true, role: 'user' },
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
			{ email: 'user@example.com', emailVerified: true, role: 'user' },
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
			{ email: 'user@example.com', emailVerified: true, role: 'user' },
		)

		expect(dbCalls.updateSet).not.toHaveBeenCalled()
	})

	it('accepts a pending invitation on the first verified sign-in', async () => {
		invitationCalls.acceptPendingInvitationForVerifiedSession.mockResolvedValue('org_1')
		const { restoreActiveAgency } = await import('../logic/activeAgency')

		await expect(
			restoreActiveAgency(
				{
					token: 'tok_1',
					userId: 'user_1',
				},
				{ email: 'invited@example.com', emailVerified: true, role: 'user' },
			),
		).resolves.toBe('org_1')

		expect(invitationCalls.acceptPendingInvitationForVerifiedSession).toHaveBeenCalledWith({
			email: 'invited@example.com',
			sessionToken: 'tok_1',
		})
		expect(dbCalls.updateSet).toHaveBeenCalledWith({ activeOrganizationId: 'org_1' })
	})
})
