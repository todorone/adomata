import { randomUUID } from 'node:crypto'

import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { and, eq, sql } from 'drizzle-orm'

import {
	connectMetaAccountsBodySchema,
	connectMetaAccountsResponseSchema,
	metaAccountsDiscoveryResponseSchema,
	type ConnectMetaAccountItem,
} from '../client/meta-accounts'
import { db } from '../db'
import { adAccount, client, organizationSettings } from '../db/schema'
import { apiError } from '../logic/apiError'
import { isOwner, requireAuth, requireOrg, requireVerifiedAuth } from '../logic/auth'
import { MetaApiError } from '../meta/client'
import { getHeartbeatDependencies, triggerAgencyBackgroundSync } from '../sync/runtime'

const getRoute = createRoute({
	method: 'get',
	path: '/',
	responses: {
		200: {
			description: 'Meta Ad Accounts discovered for the active Agency',
			content: { 'application/json': { schema: metaAccountsDiscoveryResponseSchema } },
		},
		400: { description: 'No Meta token is configured for this Agency' },
		403: { description: 'Only the Agency owner may discover Meta Ad Accounts' },
	},
})

const connectRoute = createRoute({
	method: 'post',
	path: '/connect',
	request: { body: { content: { 'application/json': { schema: connectMetaAccountsBodySchema } } } },
	responses: {
		200: {
			description: 'Ad Accounts connected',
			content: { 'application/json': { schema: connectMetaAccountsResponseSchema } },
		},
		400: { description: 'No Meta token configured' },
		403: { description: 'Only the Agency owner may connect Meta Ad Accounts' },
	},
})

const metaAccountsBase = new OpenAPIHono()
metaAccountsBase.use('*', requireAuth, requireVerifiedAuth, requireOrg)

async function loadToken(orgId: string) {
	const [row] = await db
		.select({ metaAccessToken: organizationSettings.metaAccessToken })
		.from(organizationSettings)
		.where(eq(organizationSettings.organizationId, orgId))
		.limit(1)
	return row?.metaAccessToken ?? null
}

export const metaAccountsRoutes = metaAccountsBase
	.openapi(getRoute, async c => {
		if (!isOwner(c.get('orgMember'))) {
			return apiError(c, 'FORBIDDEN', { message: 'Лише власник агенції може шукати рекламні кабінети' })
		}

		const orgId = c.get('orgId')
		const token = await loadToken(orgId)
		if (!token) return apiError(c, 'BAD_REQUEST', { message: 'Спочатку налаштуйте токен Meta' })

		let discovered
		try {
			const { buildMetaClient } = getHeartbeatDependencies()
			discovered = await buildMetaClient(token).listAdAccounts()
		} catch (error) {
			if (error instanceof MetaApiError) {
				return apiError(c, 'BAD_REQUEST', {
					message: `Не вдалося отримати рекламні кабінети Meta: ${error.message}`,
				})
			}
			throw error
		}

		const [existingRows, clientRows] = await Promise.all([
			db
				.select({
					metaAccountId: adAccount.id,
					clientId: client.id,
					clientName: client.name,
					connectionStatus: adAccount.connectionStatus,
					accountDataError: adAccount.accountDataError,
					accountDataSuccessfulAt: adAccount.accountDataSuccessfulAt,
					hierarchyError: adAccount.hierarchyError,
					hierarchySuccessfulAt: adAccount.hierarchySuccessfulAt,
					insightsError: adAccount.insightsError,
					insightsSuccessfulAt: adAccount.insightsSuccessfulAt,
					initialImportHistoryCompletedAt: adAccount.initialImportHistoryCompletedAt,
				})
				.from(adAccount)
				.innerJoin(client, eq(adAccount.clientId, client.id))
				.where(eq(client.agencyId, orgId)),
			db
				.select({ id: client.id, name: client.name, metaBusinessId: client.metaBusinessId })
				.from(client)
				.where(eq(client.agencyId, orgId)),
		])
		const existingByAccountId = new Map(existingRows.map(row => [row.metaAccountId, row]))
		const clientByBusinessId = new Map(
			clientRows.filter(row => row.metaBusinessId).map(row => [row.metaBusinessId, row]),
		)

		return c.json(
			metaAccountsDiscoveryResponseSchema.parse({
				accounts: discovered.items.map(item => {
					const existing = existingByAccountId.get(item.id)
					const businessMatch = !existing && item.businessId ? clientByBusinessId.get(item.businessId) : undefined
					return {
						metaAccountId: item.id,
						name: item.name,
						currency: item.currency,
						timezoneName: item.timezoneName,
						connected: Boolean(existing),
						initialImportStatus: initialImportStatus(existing),
						clientId: existing?.clientId ?? businessMatch?.id ?? null,
						clientName: existing?.clientName ?? businessMatch?.name ?? null,
						businessId: item.businessId,
						businessName: item.businessName,
					}
				}),
			}),
			200,
		)
	})
	.openapi(connectRoute, async c => {
		if (!isOwner(c.get('orgMember'))) {
			return apiError(c, 'FORBIDDEN', { message: 'Лише власник агенції може підключати рекламні кабінети' })
		}

		const orgId = c.get('orgId')
		const token = await loadToken(orgId)
		if (!token) return apiError(c, 'BAD_REQUEST', { message: 'Спочатку налаштуйте токен Meta' })

		const { accounts } = c.req.valid('json')
		const now = new Date()
		const results = []
		for (const account of accounts) results.push(await connectAccount(orgId, account, now))
		const connected = results.filter(result => result.status === 'connected').length

		if (connected > 0) triggerAgencyBackgroundSync(orgId, 'connect')

		return c.json(connectMetaAccountsResponseSchema.parse({ connected, results }), 200)
	})

async function connectAccount(orgId: string, account: ConnectMetaAccountItem, now: Date) {
	try {
		return await connectAccountOnce(orgId, account, now)
	} catch (error) {
		if (error instanceof AccountConnectionConflict) return await connectAccountOnce(orgId, account, now)
		throw error
	}
}

async function connectAccountOnce(orgId: string, account: ConnectMetaAccountItem, now: Date) {
	return await db.transaction(async transaction => {
		const [existingAccount] = await transaction
			.select({ clientId: adAccount.clientId, agencyId: client.agencyId })
			.from(adAccount)
			.innerJoin(client, eq(adAccount.clientId, client.id))
			.where(eq(adAccount.id, account.metaAccountId))
			.limit(1)
		if (existingAccount && existingAccount.agencyId !== orgId) {
			return {
				metaAccountId: account.metaAccountId,
				status: 'failed' as const,
				message: 'Цей рекламний кабінет уже підключено до іншої агенції',
			}
		}

		if (existingAccount) {
			await transaction
				.update(adAccount)
				.set({
					name: account.name,
					currency: account.currency,
					timezoneName: account.timezoneName,
					connectionStatus: sql`case when ${adAccount.connectionStatus} = 'access_lost' then 'pending' else ${adAccount.connectionStatus} end`,
					accountDataNextDueAt: now,
					hierarchyNextDueAt: now,
					insightsNextDueAt: now,
					updatedAt: now,
				})
				.where(eq(adAccount.id, account.metaAccountId))
			return connectedAccount(account.metaAccountId)
		}

		let resolvedClientId: string | undefined
		if (account.businessId) {
			const [businessClient] = await transaction
				.select({ id: client.id })
				.from(client)
				.where(and(eq(client.agencyId, orgId), eq(client.metaBusinessId, account.businessId)))
				.limit(1)
			resolvedClientId = businessClient?.id
		}
		if (!resolvedClientId) {
			resolvedClientId = randomUUID()
			await transaction.insert(client).values({
				id: resolvedClientId,
				agencyId: orgId,
				name: account.businessName ?? account.name,
				metaBusinessId: account.businessId ?? null,
				createdAt: now,
				updatedAt: now,
			})
		}

		const [inserted] = await transaction
			.insert(adAccount)
			.values({
				id: account.metaAccountId,
				clientId: resolvedClientId,
				name: account.name,
				currency: account.currency,
				timezoneName: account.timezoneName,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning({ id: adAccount.id })
		if (!inserted) throw new AccountConnectionConflict()

		return connectedAccount(account.metaAccountId)
	})
}

class AccountConnectionConflict extends Error {}

function connectedAccount(metaAccountId: string) {
	return { metaAccountId, status: 'connected' as const, message: 'Рекламний кабінет підключено' }
}

function initialImportStatus(
	existing:
		| {
				connectionStatus: 'pending' | 'connected' | 'access_lost'
				accountDataError: string | null
				accountDataSuccessfulAt: Date | null
				hierarchyError: string | null
				hierarchySuccessfulAt: Date | null
				insightsError: string | null
				insightsSuccessfulAt: Date | null
				initialImportHistoryCompletedAt: Date | null
		  }
		| undefined,
) {
	if (!existing || existing.connectionStatus === 'connected') return null
	if (
		existing.accountDataSuccessfulAt &&
		existing.hierarchySuccessfulAt &&
		existing.insightsSuccessfulAt &&
		existing.initialImportHistoryCompletedAt
	)
		return null
	return existing.accountDataError || existing.hierarchyError || existing.insightsError ? 'failed' : 'importing'
}
