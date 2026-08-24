import { createMiddleware } from 'hono/factory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

import { apiErrorSchema } from '../client/error'
import {
	connectMetaAccountsResponseSchema,
	metaAccountsDiscoveryResponseSchema,
	resyncMetaAccountsResponseSchema,
} from '../client/meta-accounts'
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

type InsertedClient = { id: string; agencyId: string; name: string; metaBusinessId: string | null }
type UpsertedAdAccount = Record<string, unknown>

function buildTransaction(options: {
	existingClientsByBusinessId: Array<{ id: string; metaBusinessId: string | null }>
	insertedClients: InsertedClient[]
	upsertedAdAccounts: UpsertedAdAccount[]
}) {
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
				where: () => Promise.resolve(options.existingClientsByBusinessId),
			}),
		}),
	}
}

const dbCalls = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn(), update: vi.fn() }))
const metaCalls = vi.hoisted(() => ({ listAdAccounts: vi.fn(), buildMetaClient: vi.fn() }))
const syncCalls = vi.hoisted(() => ({ triggerAgencyBackgroundSync: vi.fn() }))

vi.mock('../db', () => ({
	db: {
		select: dbCalls.select,
		transaction: dbCalls.transaction,
		update: dbCalls.update,
	},
}))

vi.mock('../sync/runtime', () => ({
	getHeartbeatDependencies: () => ({
		heartbeatSecret: 'secret',
		metaMode: 'live' as const,
		buildMetaClient: metaCalls.buildMetaClient,
	}),
	triggerAgencyBackgroundSync: syncCalls.triggerAgencyBackgroundSync,
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
	dbCalls.update.mockReset()
	metaCalls.listAdAccounts.mockReset()
	metaCalls.buildMetaClient.mockReset()
	metaCalls.buildMetaClient.mockReturnValue({ listAdAccounts: metaCalls.listAdAccounts })
	syncCalls.triggerAgencyBackgroundSync.mockReset()
})

describe('POST /meta-accounts/resync-insights', () => {
	function postResync(headers: Record<string, string> = {}) {
		return import('../app').then(({ app }) =>
			app.request('/meta-accounts/resync-insights', { method: 'POST', headers }),
		)
	}

	it('rejects a non-owner member', async () => {
		const res = await postResync({ 'x-test-role': 'member' })

		expect(res.status).toBe(403)
		expect(apiErrorSchema.parse(await res.json()).error.code).toBe('FORBIDDEN')
		expect(dbCalls.update).not.toHaveBeenCalled()
	})

	it('resets only completed Insights Tier syncs in the calling Agency', async () => {
		const from = vi.fn()
		let whereCondition: SQL | undefined
		const where = vi.fn((condition: SQL) => {
			whereCondition = condition
			return Promise.resolve(undefined)
		})
		const set = vi.fn(() => ({
			from: (...args: unknown[]) => {
				from(...args)
				return { where }
			},
		}))
		dbCalls.update.mockReturnValue({ set })

		const res = await postResync()

		expect(res.status).toBe(200)
		expect(resyncMetaAccountsResponseSchema.parse(await res.json())).toEqual({ acknowledged: true })
		expect(dbCalls.update).toHaveBeenCalledWith(adAccount)
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				accountTierRefreshedAt: null,
				insightsTierRefreshedAt: null,
				insightsSuccessfulAt: null,
				insightsNextDueAt: expect.any(Date),
				updatedAt: expect.any(Date),
			}),
		)
		expect(from).toHaveBeenCalledWith(client)
		if (!whereCondition) throw new Error('Expected an update scope')
		const scope = new PgDialect().sqlToQuery(whereCondition)
		expect(scope.sql).toBe(
			'("ad_account"."clientId" = "client"."id" and "client"."agencyId" = $1 and "ad_account"."insightsSuccessfulAt" is not null)',
		)
		expect(scope.params).toEqual(['org_1'])
	})
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

	it('resolves connected, business-matched, and unmatched accounts', async () => {
		dbCalls.select
			.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
			.mockImplementationOnce(() =>
				chain([{ metaAccountId: 'act_1', clientId: 'client_1', clientName: 'Northstar' }]),
			)
			.mockImplementationOnce(() =>
				chain([
					{ id: 'client_1', name: 'Northstar', metaBusinessId: 'biz_1' },
					{ id: 'client_2', name: 'Meridian', metaBusinessId: 'biz_2' },
				]),
			)
		metaCalls.listAdAccounts.mockResolvedValue({
			items: [
				{
					id: 'act_1',
					name: 'Already connected',
					currency: 'USD',
					timezoneName: 'Europe/Kyiv',
					businessId: 'biz_1',
					businessName: 'Northstar',
				},
				{
					id: 'act_2',
					name: 'Same business, new account',
					currency: 'USD',
					timezoneName: null,
					businessId: 'biz_2',
					businessName: 'Meridian',
				},
				{
					id: 'act_3',
					name: 'No business',
					currency: 'USD',
					timezoneName: null,
					businessId: null,
					businessName: null,
				},
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
					businessId: 'biz_1',
					businessName: 'Northstar',
				},
				{
					metaAccountId: 'act_2',
					name: 'Same business, new account',
					currency: 'USD',
					timezoneName: null,
					connected: false,
					clientId: 'client_2',
					clientName: 'Meridian',
					businessId: 'biz_2',
					businessName: 'Meridian',
				},
				{
					metaAccountId: 'act_3',
					name: 'No business',
					currency: 'USD',
					timezoneName: null,
					connected: false,
					clientId: null,
					clientName: null,
					businessId: null,
					businessName: null,
				},
			],
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
			{ accounts: [{ metaAccountId: 'act_1', name: 'A', currency: 'USD', timezoneName: null }] },
			{ 'x-test-role': 'member' },
		)

		expect(res.status).toBe(403)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('FORBIDDEN')
		expect(dbCalls.transaction).not.toHaveBeenCalled()
		expect(syncCalls.triggerAgencyBackgroundSync).not.toHaveBeenCalled()
	})

	it('rejects when no Meta token is configured', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([]))

		const res = await postConnect({
			accounts: [{ metaAccountId: 'act_1', name: 'A', currency: 'USD', timezoneName: null }],
		})

		expect(res.status).toBe(400)
		const body = apiErrorSchema.parse(await res.json())
		expect(body.error.code).toBe('BAD_REQUEST')
		expect(dbCalls.transaction).not.toHaveBeenCalled()
		expect(syncCalls.triggerAgencyBackgroundSync).not.toHaveBeenCalled()
	})

	it('attaches an account to the existing Client matched by Meta business id', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
		const insertedClients: InsertedClient[] = []
		const upsertedAdAccounts: UpsertedAdAccount[] = []
		dbCalls.transaction.mockImplementationOnce(async callback =>
			callback(
				buildTransaction({
					existingClientsByBusinessId: [{ id: 'client_1', metaBusinessId: 'biz_1' }],
					insertedClients,
					upsertedAdAccounts,
				}),
			),
		)

		const res = await postConnect({
			accounts: [
				{
					metaAccountId: 'act_1',
					name: 'Account 1',
					currency: 'USD',
					timezoneName: 'Europe/Kyiv',
					businessId: 'biz_1',
					businessName: 'Northstar',
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
		expect(syncCalls.triggerAgencyBackgroundSync).toHaveBeenCalledWith('org_1', 'connect')
	})

	it('creates exactly one Client, named after the business, when two accounts share a Meta business id', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
		const insertedClients: InsertedClient[] = []
		const upsertedAdAccounts: UpsertedAdAccount[] = []
		dbCalls.transaction.mockImplementationOnce(async callback =>
			callback(buildTransaction({ existingClientsByBusinessId: [], insertedClients, upsertedAdAccounts })),
		)

		const res = await postConnect({
			accounts: [
				{
					metaAccountId: 'act_1',
					name: 'Account 1',
					currency: 'USD',
					timezoneName: null,
					businessId: 'biz_1',
					businessName: 'Acme Holdings',
				},
				{
					metaAccountId: 'act_2',
					name: 'Account 2',
					currency: 'USD',
					timezoneName: null,
					businessId: 'biz_1',
					businessName: 'Acme Holdings',
				},
			],
		})

		expect(res.status).toBe(200)
		const body = connectMetaAccountsResponseSchema.parse(await res.json())
		expect(body).toEqual({ connected: 2 })
		expect(insertedClients).toHaveLength(1)
		expect(insertedClients[0]).toMatchObject({ agencyId: 'org_1', name: 'Acme Holdings', metaBusinessId: 'biz_1' })
		expect(upsertedAdAccounts).toHaveLength(2)
		expect(upsertedAdAccounts[0]?.clientId).toBe(insertedClients[0]?.id)
		expect(upsertedAdAccounts[1]?.clientId).toBe(insertedClients[0]?.id)
	})

	it('creates a standalone Client per account when Meta reports no business', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
		const insertedClients: InsertedClient[] = []
		const upsertedAdAccounts: UpsertedAdAccount[] = []
		dbCalls.transaction.mockImplementationOnce(async callback =>
			callback(buildTransaction({ existingClientsByBusinessId: [], insertedClients, upsertedAdAccounts })),
		)

		const res = await postConnect({
			accounts: [{ metaAccountId: 'act_1', name: 'Solo account', currency: 'USD', timezoneName: null }],
		})

		expect(res.status).toBe(200)
		const body = connectMetaAccountsResponseSchema.parse(await res.json())
		expect(body).toEqual({ connected: 1 })
		expect(insertedClients).toHaveLength(1)
		expect(insertedClients[0]).toMatchObject({ agencyId: 'org_1', name: 'Solo account', metaBusinessId: null })
		expect(upsertedAdAccounts[0]?.clientId).toBe(insertedClients[0]?.id)
	})
})
