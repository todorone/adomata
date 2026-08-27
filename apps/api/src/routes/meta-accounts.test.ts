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

type InsertedClient = { id: string; agencyId: string; name: string; metaBusinessId: string | null }
type UpsertedAdAccount = Record<string, unknown>

function buildTransaction(options: {
	existingClientsByBusinessId: Array<{ id: string; metaBusinessId: string | null }>
	existingAdAccountResults?: Array<Array<{ clientId: string; agencyId: string }>>
	insertedClients: InsertedClient[]
	upsertedAdAccounts: UpsertedAdAccount[]
	updatedAdAccounts?: UpsertedAdAccount[]
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
						onConflictDoNothing: () => ({
							returning: () => {
								options.upsertedAdAccounts.push(values)
								return Promise.resolve([{ id: values.id }])
							},
						}),
					}
				}
				throw new Error('Unexpected insert table in test double')
			},
		}),
		select: () => ({
			from: (table: unknown) => {
				if (table === adAccount) {
					return {
						innerJoin: () => ({
							where: () => ({
								limit: () => Promise.resolve(options.existingAdAccountResults?.shift() ?? []),
							}),
						}),
					}
				}
				if (table === client) {
					return {
						where: () => ({
							limit: () => Promise.resolve([...options.existingClientsByBusinessId, ...options.insertedClients]),
						}),
					}
				}
				throw new Error('Unexpected select table in test double')
			},
		}),
		update: (table: unknown) => {
			if (table !== adAccount) throw new Error('Unexpected update table in test double')
			return {
				set: (values: UpsertedAdAccount) => ({
					where: () => {
						options.updatedAdAccounts?.push(values)
						return Promise.resolve(undefined)
					},
				}),
			}
		},
	}
}

const dbCalls = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn() }))
const metaCalls = vi.hoisted(() => ({ listAdAccounts: vi.fn(), buildMetaClient: vi.fn() }))
const syncCalls = vi.hoisted(() => ({ triggerAgencyBackgroundSync: vi.fn() }))

vi.mock('../db', () => ({
	db: {
		select: dbCalls.select,
		transaction: dbCalls.transaction,
	},
}))

vi.mock('../sync/runtime', () => ({
	getSchedulerDependencies: () => ({
		schedulerSecret: 'secret',
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
	metaCalls.listAdAccounts.mockReset()
	metaCalls.buildMetaClient.mockReset()
	metaCalls.buildMetaClient.mockReturnValue({ listAdAccounts: metaCalls.listAdAccounts })
	syncCalls.triggerAgencyBackgroundSync.mockReset()
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
				chain([
					{
						metaAccountId: 'act_1',
						clientId: 'client_1',
						clientName: 'Northstar',
						connectionStatus: 'connected',
						accountDataError: null,
						accountDataSuccessfulAt: new Date(),
						hierarchyError: null,
						hierarchySuccessfulAt: new Date(),
						insightsError: null,
						insightsSuccessfulAt: new Date(),
						initialImportHistoryCompletedAt: new Date(),
					},
				]),
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
			throttle: { appExhausted: false, accountExhausted: false },
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
					initialImportStatus: null,
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
					initialImportStatus: null,
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
					initialImportStatus: null,
					clientId: null,
					clientName: null,
					businessId: null,
					businessName: null,
				},
			],
		})
		expect(metaCalls.buildMetaClient).toHaveBeenCalledWith('a-token')
	})

	it('reports a failed pending import so the connection flow can retry it', async () => {
		dbCalls.select
			.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
			.mockImplementationOnce(() =>
				chain([
					{
						metaAccountId: 'act_1',
						clientId: 'client_1',
						clientName: 'Northstar',
						connectionStatus: 'access_lost',
						accountDataError: null,
						accountDataSuccessfulAt: null,
						hierarchyError: 'Meta тимчасово недоступна',
						hierarchySuccessfulAt: null,
						insightsError: null,
						insightsSuccessfulAt: null,
						initialImportHistoryCompletedAt: null,
					},
				]),
			)
			.mockImplementationOnce(() => chain([{ id: 'client_1', name: 'Northstar', metaBusinessId: 'biz_1' }]))
		metaCalls.listAdAccounts.mockResolvedValue({
			items: [
				{
					id: 'act_1',
					name: 'Pending account',
					currency: 'USD',
					timezoneName: 'Europe/Kyiv',
					businessId: 'biz_1',
					businessName: 'Northstar',
				},
			],
			throttle: { appExhausted: false, accountExhausted: false },
		})
		const { app } = await import('../app')

		const res = await app.request('/meta-accounts')

		expect(res.status).toBe(200)
		expect(metaAccountsDiscoveryResponseSchema.parse(await res.json())).toMatchObject({
			accounts: [
				{
					metaAccountId: 'act_1',
					connected: true,
					initialImportStatus: 'failed',
				},
			],
		})
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
		const transaction = buildTransaction({
			existingClientsByBusinessId: [{ id: 'client_1', metaBusinessId: 'biz_1' }],
			insertedClients,
			upsertedAdAccounts,
		})
		dbCalls.transaction.mockImplementation(callback => callback(transaction))

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
		expect(body).toEqual({
			connected: 1,
			results: [{ metaAccountId: 'act_1', status: 'connected', message: 'Рекламний кабінет підключено' }],
		})
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
		const transaction = buildTransaction({ existingClientsByBusinessId: [], insertedClients, upsertedAdAccounts })
		dbCalls.transaction.mockImplementation(callback => callback(transaction))

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
		expect(body).toEqual({
			connected: 2,
			results: [
				{ metaAccountId: 'act_1', status: 'connected', message: 'Рекламний кабінет підключено' },
				{ metaAccountId: 'act_2', status: 'connected', message: 'Рекламний кабінет підключено' },
			],
		})
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
		const transaction = buildTransaction({ existingClientsByBusinessId: [], insertedClients, upsertedAdAccounts })
		dbCalls.transaction.mockImplementation(callback => callback(transaction))

		const res = await postConnect({
			accounts: [{ metaAccountId: 'act_1', name: 'Solo account', currency: 'USD', timezoneName: null }],
		})

		expect(res.status).toBe(200)
		const body = connectMetaAccountsResponseSchema.parse(await res.json())
		expect(body).toEqual({
			connected: 1,
			results: [{ metaAccountId: 'act_1', status: 'connected', message: 'Рекламний кабінет підключено' }],
		})
		expect(insertedClients).toHaveLength(1)
		expect(insertedClients[0]).toMatchObject({ agencyId: 'org_1', name: 'Solo account', metaBusinessId: null })
		expect(upsertedAdAccounts[0]?.clientId).toBe(insertedClients[0]?.id)
	})

	it('retries an account already owned by this Agency without moving its Client', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
		const insertedClients: InsertedClient[] = []
		const upsertedAdAccounts: UpsertedAdAccount[] = []
		const updatedAdAccounts: UpsertedAdAccount[] = []
		const transaction = buildTransaction({
			existingClientsByBusinessId: [],
			existingAdAccountResults: [[{ clientId: 'original_client', agencyId: 'org_1' }]],
			insertedClients,
			upsertedAdAccounts,
			updatedAdAccounts,
		})
		dbCalls.transaction.mockImplementation(callback => callback(transaction))

		const res = await postConnect({
			accounts: [
				{
					metaAccountId: 'act_1',
					name: 'Retried account',
					currency: 'USD',
					timezoneName: 'Europe/Kyiv',
					businessId: 'different-business',
					businessName: 'Different business',
				},
			],
		})

		expect(res.status).toBe(200)
		expect(insertedClients).toEqual([])
		expect(upsertedAdAccounts).toEqual([])
		expect(updatedAdAccounts).toMatchObject([
			{
				name: 'Retried account',
				currency: 'USD',
				timezoneName: 'Europe/Kyiv',
				accountDataNextDueAt: expect.any(Date),
				hierarchyNextDueAt: expect.any(Date),
				insightsNextDueAt: expect.any(Date),
			},
		])
		expect(updatedAdAccounts[0]).not.toHaveProperty('clientId')
	})

	it('connects available accounts while rejecting an account owned by another Agency', async () => {
		dbCalls.select.mockImplementationOnce(() => chain([{ metaAccessToken: 'a-token' }]))
		const insertedClients: InsertedClient[] = []
		const upsertedAdAccounts: UpsertedAdAccount[] = []
		const transaction = buildTransaction({
			existingClientsByBusinessId: [],
			existingAdAccountResults: [[], [{ clientId: 'foreign_client', agencyId: 'org_other' }]],
			insertedClients,
			upsertedAdAccounts,
		})
		dbCalls.transaction.mockImplementation(callback => callback(transaction))

		const res = await postConnect({
			accounts: [
				{ metaAccountId: 'act_available', name: 'Available', currency: 'USD', timezoneName: null },
				{ metaAccountId: 'act_foreign', name: 'Foreign', currency: 'USD', timezoneName: null },
			],
		})

		expect(res.status).toBe(200)
		expect(connectMetaAccountsResponseSchema.parse(await res.json())).toEqual({
			connected: 1,
			results: [
				{ metaAccountId: 'act_available', status: 'connected', message: 'Рекламний кабінет підключено' },
				{
					metaAccountId: 'act_foreign',
					status: 'failed',
					message: 'Цей рекламний кабінет уже підключено до іншої агенції',
				},
			],
		})
		expect(insertedClients).toHaveLength(1)
		expect(upsertedAdAccounts).toEqual([expect.objectContaining({ id: 'act_available' })])
		expect(syncCalls.triggerAgencyBackgroundSync).toHaveBeenCalledWith('org_1', 'connect')
	})
})
