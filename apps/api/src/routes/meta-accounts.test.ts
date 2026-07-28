import { createMiddleware } from 'hono/factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiErrorSchema } from '../client/error'
import { connectMetaAccountsResponseSchema, metaAccountsDiscoveryResponseSchema } from '../client/meta-accounts'
import { adAccount, client } from '../db/schema'
import { MetaApiError } from '../meta/client'

type Chain = PromiseLike<unknown> & {
	from: (...args: unknown[]) => Chain
	innerJoin: (...args: unknown[]) => Chain
	where: (...args: unknown[]) => Chain
	limit: (...args: unknown[]) => Chain
}

function chain(result: unknown): Chain {
	const self: Chain = {
		from: () => self,
		innerJoin: () => self,
		where: () => self,
		limit: () => self,
		then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
	}
	return self
}

type InsertedClient = { id: string; agencyId: string; name: string }
type UpsertedAdAccount = Record<string, unknown>

function buildTransaction(options: {
	ownershipResults: boolean[]
	insertedClients: InsertedClient[]
	upsertedAdAccounts: UpsertedAdAccount[]
}) {
	let ownershipIndex = 0
	return {
		insert: (table: unknown) => ({
			values: (values: Record<string, unknown>) => {
				if (table === client) {
					options.insertedClients.push(values as InsertedClient)
					return Promise.resolve(undefined)
				}
				if (table === adAccount) {
					return {
						onConflictDoUpdate: () => {
							options.upsertedAdAccounts.push(values)
							return Promise.resolve(undefined)
						},
					}
				}
				throw new Error('Unexpected insert table in test double')
			},
		}),
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => {
						const owned = options.ownershipResults[ownershipIndex] ?? false
						ownershipIndex += 1
						return owned ? [{ id: 'owned' }] : []
					},
				}),
			}),
		}),
	}
}

const dbCalls = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn() }))
const metaCalls = vi.hoisted(() => ({ listAdAccounts: vi.fn(), buildMetaClient: vi.fn() }))

vi.mock('../db', () => ({
	db: {
		select: dbCalls.select,
		transaction: dbCalls.transaction,
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
	dbCalls.select.mockReset()
	dbCalls.transaction.mockReset()
	metaCalls.listAdAccounts.mockReset()
	metaCalls.buildMetaClient.mockReset()
	metaCalls.buildMetaClient.mockReturnValue({ listAdAccounts: metaCalls.listAdAccounts })
})

describe('GET /meta-accounts', () => {
	it('rejects a non-owner member', async () => {
		const { app } = await import('../app')

		const res = await app.request('/meta-accounts', { headers: { 'x-test-role': 'admin' } })

		expect(res.status).toBe(403)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('FORBIDDEN')
		expect(dbCalls.select).not.toHaveBeenCalled()
	})

	it('rejects when no Meta token is configured', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([]))
		const { app } = await import('../app')

		const res = await app.request('/meta-accounts')

		expect(res.status).toBe(400)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('BAD_REQUEST')
		expect(metaCalls.listAdAccounts).not.toHaveBeenCalled()
	})

	it('wraps a Meta API failure as BAD_REQUEST', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
		metaCalls.listAdAccounts.mockRejectedValue(new MetaApiError('Invalid OAuth access token', 401, 190))
		const { app } = await import('../app')

		const res = await app.request('/meta-accounts')

		expect(res.status).toBe(400)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('BAD_REQUEST')
	})

	it('splits discovered accounts into connected/unconnected and returns the Agency Clients', async () => {
		dbCalls.select
			.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
			.mockImplementationOnce(() =>
				chain([{ metaAccountId: 'act_1', clientId: 'client_1', clientName: 'Northstar' }]),
			)
			.mockImplementationOnce(() => chain([{ id: 'client_1', name: 'Northstar' }]))
		metaCalls.listAdAccounts.mockResolvedValue({
			items: [
				{ id: 'act_1', name: 'Already connected', currency: 'USD', timezoneName: 'Europe/Kyiv' },
				{ id: 'act_2', name: 'Undiscovered', currency: 'USD', timezoneName: null },
			],
			throttle: { exhausted: false },
		})
		const { app } = await import('../app')

		const res = await app.request('/meta-accounts')

		expect(res.status).toBe(200)
		const body = metaAccountsDiscoveryResponseSchema.parse(await res.json())
		expect(body).toEqual({
			accounts: [
				{
					metaAccountId: 'act_1',
					name: 'Already connected',
					currency: 'USD',
					timezoneName: 'Europe/Kyiv',
					connected: true,
					clientId: 'client_1',
					clientName: 'Northstar',
				},
				{
					metaAccountId: 'act_2',
					name: 'Undiscovered',
					currency: 'USD',
					timezoneName: null,
					connected: false,
					clientId: null,
					clientName: null,
				},
			],
			clients: [{ id: 'client_1', name: 'Northstar' }],
		})
		expect(metaCalls.buildMetaClient).toHaveBeenCalledWith('a-token')
	})
})

describe('POST /meta-accounts/connect', () => {
	function postConnect(body: unknown, headers: Record<string, string> = {}) {
		return import('../app').then(({ app }) =>
			app.request('/meta-accounts/connect', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...headers },
				body: JSON.stringify(body),
			}),
		)
	}

	it('rejects a non-owner member', async () => {
		const res = await postConnect(
			{ accounts: [{ metaAccountId: 'act_1', name: 'A', currency: 'USD', timezoneName: null, clientId: 'c1' }] },
			{ 'x-test-role': 'member' },
		)

		expect(res.status).toBe(403)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('FORBIDDEN')
		expect(dbCalls.transaction).not.toHaveBeenCalled()
	})

	it('rejects when no Meta token is configured', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([]))

		const res = await postConnect({
			accounts: [{ metaAccountId: 'act_1', name: 'A', currency: 'USD', timezoneName: null, clientId: 'c1' }],
		})

		expect(res.status).toBe(400)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('BAD_REQUEST')
		expect(dbCalls.transaction).not.toHaveBeenCalled()
	})

	it('connects an account to an existing Client', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
		const insertedClients: InsertedClient[] = []
		const upsertedAdAccounts: UpsertedAdAccount[] = []
		dbCalls.transaction.mockImplementationOnce(async callback =>
			callback(buildTransaction({ ownershipResults: [true], insertedClients, upsertedAdAccounts })),
		)

		const res = await postConnect({
			accounts: [
				{
					metaAccountId: 'act_1',
					name: 'Account 1',
					currency: 'USD',
					timezoneName: 'Europe/Kyiv',
					clientId: 'client_1',
				},
			],
		})

		expect(res.status).toBe(200)
		const body = connectMetaAccountsResponseSchema.parse(await res.json())
		expect(body).toEqual({ connected: 1 })
		expect(insertedClients).toEqual([])
		expect(upsertedAdAccounts).toEqual([
			expect.objectContaining({ id: 'act_1', clientId: 'client_1', name: 'Account 1', currency: 'USD' }),
		])
	})

	it('creates exactly one Client when two accounts share the same newClientName', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
		const insertedClients: InsertedClient[] = []
		const upsertedAdAccounts: UpsertedAdAccount[] = []
		dbCalls.transaction.mockImplementationOnce(async callback =>
			callback(buildTransaction({ ownershipResults: [], insertedClients, upsertedAdAccounts })),
		)

		const res = await postConnect({
			accounts: [
				{ metaAccountId: 'act_1', name: 'Account 1', currency: 'USD', timezoneName: null, newClientName: 'Acme' },
				{ metaAccountId: 'act_2', name: 'Account 2', currency: 'USD', timezoneName: null, newClientName: 'Acme' },
			],
		})

		expect(res.status).toBe(200)
		const body = connectMetaAccountsResponseSchema.parse(await res.json())
		expect(body).toEqual({ connected: 2 })
		expect(insertedClients).toHaveLength(1)
		expect(insertedClients[0]).toMatchObject({ agencyId: 'org_1', name: 'Acme' })
		expect(upsertedAdAccounts).toHaveLength(2)
		expect(upsertedAdAccounts[0]?.clientId).toBe(insertedClients[0]?.id)
		expect(upsertedAdAccounts[1]?.clientId).toBe(insertedClients[0]?.id)
	})

	it('rejects a clientId belonging to a different Agency and writes nothing', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
		const insertedClients: InsertedClient[] = []
		const upsertedAdAccounts: UpsertedAdAccount[] = []
		dbCalls.transaction.mockImplementationOnce(async callback =>
			callback(buildTransaction({ ownershipResults: [false], insertedClients, upsertedAdAccounts })),
		)

		const res = await postConnect({
			accounts: [
				{
					metaAccountId: 'act_1',
					name: 'Account 1',
					currency: 'USD',
					timezoneName: null,
					clientId: 'other-agency-client',
				},
			],
		})

		expect(res.status).toBe(400)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('BAD_REQUEST')
		expect(insertedClients).toEqual([])
		expect(upsertedAdAccounts).toEqual([])
	})
})
