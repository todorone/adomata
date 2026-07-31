import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
	acceptInvitation: vi.fn(),
	insertResult: [] as Array<{ id: string }>,
	insertValues: vi.fn(),
	selectResults: [] as Array<Array<Record<string, unknown>>>,
	updateSet: vi.fn(),
}))

vi.mock('../db', () => ({
	db: {
		insert: vi.fn(() => ({
			values: vi.fn(value => {
				calls.insertValues(value)
				return {
					onConflictDoNothing: vi.fn(() => ({
						returning: vi.fn(async () => calls.insertResult),
					})),
				}
			}),
		})),
		select: vi.fn(() => {
			const rows = calls.selectResults.shift() ?? []
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
				where: vi.fn(async () => calls.updateSet(value)),
			})),
		})),
	},
}))

describe('invitation logic', () => {
	beforeEach(() => {
		calls.acceptInvitation.mockReset()
		calls.insertResult = []
		calls.insertValues.mockReset()
		calls.selectResults = []
		calls.updateSet.mockReset()
	})

	it('accepts the oldest pending invitation for a verified session', async () => {
		calls.selectResults = [[{ id: 'inv_1', organizationId: 'org_1' }]]
		const { acceptPendingInvitationForVerifiedSession } = await import('./invitation')

		await expect(
			acceptPendingInvitationForVerifiedSession({
				email: 'OWNER@EXAMPLE.COM',
				acceptInvitation: calls.acceptInvitation,
			}),
		).resolves.toBe('org_1')

		expect(calls.acceptInvitation).toHaveBeenCalledWith('inv_1')
	})

	it('creates membership and accepts the invitation for an existing verified owner', async () => {
		calls.selectResults = [[{ id: 'user_1', emailVerified: true }], []]
		calls.insertResult = [{ id: 'member_1' }]
		const { acceptInvitationForExistingVerifiedUser } = await import('./invitation')

		await expect(
			acceptInvitationForExistingVerifiedUser({
				id: 'inv_1',
				email: 'owner@example.com',
				organizationId: 'org_1',
				role: 'owner',
			}),
		).resolves.toBe(true)

		expect(calls.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: 'org_1',
				role: 'owner',
				userId: 'user_1',
			}),
		)
		expect(calls.updateSet).toHaveBeenCalledWith({ status: 'accepted' })
	})

	it('leaves an invitation pending when its recipient is not verified', async () => {
		calls.selectResults = [[{ id: 'user_1', emailVerified: false }]]
		const { acceptInvitationForExistingVerifiedUser } = await import('./invitation')

		await expect(
			acceptInvitationForExistingVerifiedUser({
				id: 'inv_1',
				email: 'owner@example.com',
				organizationId: 'org_1',
				role: 'owner',
			}),
		).resolves.toBe(false)

		expect(calls.insertValues).not.toHaveBeenCalled()
		expect(calls.updateSet).not.toHaveBeenCalled()
	})
})
