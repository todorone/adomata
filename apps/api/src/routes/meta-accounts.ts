import { randomUUID } from 'node:crypto'

import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'

import {
	connectMetaAccountsBodySchema,
	connectMetaAccountsResponseSchema,
	metaAccountsDiscoveryResponseSchema,
} from '../client/meta-accounts'
import { db } from '../db'
import { adAccount, client, organizationSettings } from '../db/schema'
import { apiError } from '../logic/apiError'
import { isOwner, requireAuth, requireOrg, requireVerifiedAuth } from '../logic/auth'
import { MetaApiError } from '../meta/client'
import { getHeartbeatDependencies } from '../sync/runtime'

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
		400: { description: 'No Meta token configured, or an unknown Client was referenced' },
		403: { description: 'Only the Agency owner may connect Meta Ad Accounts' },
	},
})

const metaAccountsBase = new OpenAPIHono()
metaAccountsBase.use('*', requireAuth, requireVerifiedAuth, requireOrg)

class UnknownClientError extends Error {}

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
				.select({ metaAccountId: adAccount.id, clientId: client.id, clientName: client.name })
				.from(adAccount)
				.innerJoin(client, eq(adAccount.clientId, client.id))
				.where(eq(client.agencyId, orgId)),
			db.select({ id: client.id, name: client.name }).from(client).where(eq(client.agencyId, orgId)),
		])
		const existingByAccountId = new Map(existingRows.map(row => [row.metaAccountId, row]))

		return c.json(
			metaAccountsDiscoveryResponseSchema.parse({
				accounts: discovered.items.map(item => {
					const existing = existingByAccountId.get(item.id)
					return {
						metaAccountId: item.id,
						name: item.name,
						currency: item.currency,
						timezoneName: item.timezoneName,
						connected: Boolean(existing),
						clientId: existing?.clientId ?? null,
						clientName: existing?.clientName ?? null,
					}
				}),
				clients: clientRows,
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

		try {
			const connected = await db.transaction(async transaction => {
				const newClientNames = new Set(
					accounts.flatMap(account => (account.newClientName ? [account.newClientName] : [])),
				)
				const clientIdByNewName = new Map<string, string>()
				for (const name of newClientNames) {
					const id = randomUUID()
					await transaction.insert(client).values({ id, agencyId: orgId, name, createdAt: now, updatedAt: now })
					clientIdByNewName.set(name, id)
				}

				const explicitClientIds = new Set(accounts.flatMap(account => (account.clientId ? [account.clientId] : [])))
				for (const clientId of explicitClientIds) {
					const [owned] = await transaction
						.select({ id: client.id })
						.from(client)
						.where(and(eq(client.id, clientId), eq(client.agencyId, orgId)))
						.limit(1)
					if (!owned) throw new UnknownClientError(clientId)
				}

				for (const account of accounts) {
					const resolvedClientId = account.clientId ?? clientIdByNewName.get(account.newClientName ?? '')
					if (!resolvedClientId) throw new UnknownClientError(account.newClientName ?? '')
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

			return c.json(connectMetaAccountsResponseSchema.parse({ connected }), 200)
		} catch (error) {
			if (error instanceof UnknownClientError) {
				return apiError(c, 'BAD_REQUEST', { message: 'Клієнта не знайдено для цієї агенції' })
			}
			throw error
		}
	})
