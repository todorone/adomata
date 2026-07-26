import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import { db } from '../db'
import { adAccount } from '../db/schema'
import { MetaApiError, MetaClient } from '../meta/client'

const accountTierLock = 190019
const refreshIntervalMilliseconds = 5 * 60 * 1000

type RunHeartbeatOptions = {
	metaClient?: MetaClient
	now?: Date
}

export async function runHeartbeat({ metaClient, now = new Date() }: RunHeartbeatOptions = {}) {
	const client =
		metaClient ?? new MetaClient({ accessToken: process.env.META_ACCESS_TOKEN?.trim() || 'fake-meta-access-token' })
	return db.transaction(async transaction => {
		const lockRows = await transaction.execute(
			sql<{ locked: boolean }>`select pg_try_advisory_xact_lock(${accountTierLock}) as locked`,
		)
		if (!lockRows[0]?.locked) return { skipped: true, processed: 0 }

		const dueAccounts = await transaction
			.select()
			.from(adAccount)
			.where(
				and(
					inArray(adAccount.connectionStatus, ['pending', 'connected']),
					or(
						isNull(adAccount.accountTierRefreshedAt),
						lte(adAccount.accountTierRefreshedAt, new Date(now.getTime() - refreshIntervalMilliseconds)),
					),
				),
			)

		for (const account of dueAccounts) {
			try {
				const health = await client.getAccount(account.id)
				await transaction
					.update(adAccount)
					.set({
						name: health.name,
						currency: health.currency,
						connectionStatus: 'connected',
						metaAccountStatus: health.metaAccountStatus,
						metaDisableReason: health.metaDisableReason,
						balance: health.balance,
						isPrepayAccount: health.isPrepayAccount,
						fundingSourceType: health.fundingSourceType,
						accountTierRefreshedAt: now,
						lastPollAttemptAt: now,
						lastPollError: null,
						updatedAt: now,
					})
					.where(eq(adAccount.id, account.id))
			} catch (error) {
				const accessLost = error instanceof MetaApiError && error.code === 10
				await transaction
					.update(adAccount)
					.set({
						...(accessLost ? { connectionStatus: 'access_lost' as const } : {}),
						lastPollAttemptAt: now,
						lastPollError: describePollError(error),
						updatedAt: now,
					})
					.where(eq(adAccount.id, account.id))
			}
		}

		return { skipped: false, processed: dueAccounts.length }
	})
}

function describePollError(error: unknown) {
	if (error instanceof MetaApiError) {
		return [
			error.message,
			error.code ? `code=${error.code}` : undefined,
			error.fbtraceId ? `fbtrace=${error.fbtraceId}` : undefined,
		]
			.filter(Boolean)
			.join(' ')
	}
	return error instanceof Error ? error.message : 'Unknown Meta poll failure'
}
