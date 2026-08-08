import { randomUUID } from 'node:crypto'

import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'

import {
	connectMetaAccountsBodySchema,
	connectMetaAccountsResponseSchema,
	metaAccountsDiscoveryResponseSchema,
	resyncMetaAccountsResponseSchema,
} from '../client/meta-accounts'
import { db } from '../db'
import { adAccount, client, organizationSettings } from '../db/schema'
import { apiError } from '../logic/apiError'
import { isOwner, requireAuth, requireOrg, requireVerifiedAuth } from '../logic/auth'
import { MetaApiError } from '../meta/client'
import { getHeartbeatDependencies, triggerBackgroundSync } from '../sync/runtime'

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

const resyncInsightsRoute = createRoute({
	method: 'post',
	path: '/resync-insights',
	responses: {
		200: {
			description: 'Existing Ad Accounts queued for Insights history resync',
			content: { 'application/json': { schema: resyncMetaAccountsResponseSchema } },
		},
		403: { description: 'Only the Agency owner may resync Insights history' },
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
	.openapi(resyncInsightsRoute, async c => {
		if (!isOwner(c.get('orgMember'))) {
			return apiError(c, 'FORBIDDEN', { message: 'Лише власник агенції може повторно синхронізувати історію' })
		}

		const now = new Date()
		await db
			.update(adAccount)
			.set({ accountTierRefreshedAt: null, insightsTierRefreshedAt: null, updatedAt: now })
			.from(client)
			.where(
				and(
					eq(adAccount.clientId, client.id),
					eq(client.agencyId, c.get('orgId')),
					isNotNull(adAccount.insightsTierRefreshedAt),
				),
			)

		return c.json(resyncMetaAccountsResponseSchema.parse({ acknowledged: true }), 200)
	})
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
				.select({ metaAccountId: adAccount.id, clientId: client.id, clientName: client.name })
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

		const connected = await db.transaction(async transaction => {
			const businessIds = [...new Set(accounts.flatMap(account => (account.businessId ? [account.businessId] : [])))]
			const clientIdByBusinessId = new Map<string, string>()
			if (businessIds.length > 0) {
				const existing = await transaction
					.select({ id: client.id, metaBusinessId: client.metaBusinessId })
					.from(client)
					.where(and(eq(client.agencyId, orgId), inArray(client.metaBusinessId, businessIds)))
				for (const row of existing) if (row.metaBusinessId) clientIdByBusinessId.set(row.metaBusinessId, row.id)
			}

			for (const account of accounts) {
				if (account.businessId && !clientIdByBusinessId.has(account.businessId)) {
					const id = randomUUID()
					await transaction.insert(client).values({
						id,
						agencyId: orgId,
						name: account.businessName ?? account.name,
						metaBusinessId: account.businessId,
						createdAt: now,
						updatedAt: now,
					})
					clientIdByBusinessId.set(account.businessId, id)
				}
			}

			for (const account of accounts) {
				let resolvedClientId = account.businessId ? clientIdByBusinessId.get(account.businessId) : undefined
				if (!resolvedClientId) {
					resolvedClientId = randomUUID()
					await transaction.insert(client).values({
						id: resolvedClientId,
						agencyId: orgId,
						name: account.name,
						metaBusinessId: null,
						createdAt: now,
						updatedAt: now,
					})
				}
				await transaction
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
					.onConflictDoUpdate({
						target: adAccount.id,
						set: {
							clientId: resolvedClientId,
							name: account.name,
							currency: account.currency,
							timezoneName: account.timezoneName,
							updatedAt: now,
						},
					})
			}

			return accounts.length
		})

		triggerBackgroundSync()

		return c.json(connectMetaAccountsResponseSchema.parse({ connected }), 200)
	})
