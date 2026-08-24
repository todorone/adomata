import { randomUUID } from 'node:crypto'

import { and, eq, inArray } from 'drizzle-orm'

import { db } from '../db'
import { adAccount, client, organizationSettings, syncAccountOutcome, syncRun } from '../db/schema'

export async function replaceMetaAccessTokenAndRecoverAccounts({
	agencyId,
	metaAccessToken,
	now = new Date(),
}: {
	agencyId: string
	metaAccessToken: string
	now?: Date
}) {
	return db.transaction(async transaction => {
		const [settings] = await transaction
			.insert(organizationSettings)
			.values({
				id: randomUUID(),
				organizationId: agencyId,
				metaAccessToken,
				lastValidatedAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: organizationSettings.organizationId,
				set: { metaAccessToken, lastValidatedAt: now, updatedAt: now },
			})
			.returning()

		const recoveredAccounts = await transaction
			.update(adAccount)
			.set({
				connectionStatus: 'pending',
				accountDataNextDueAt: now,
				hierarchyNextDueAt: now,
				insightsNextDueAt: now,
				creativeNextDueAt: now,
				updatedAt: now,
			})
			.from(client)
			.where(
				and(
					eq(adAccount.clientId, client.id),
					eq(client.agencyId, agencyId),
					eq(adAccount.connectionStatus, 'access_lost'),
				),
			)
			.returning({
				id: adAccount.id,
				accountDataSuccessfulAt: adAccount.accountDataSuccessfulAt,
				hierarchySuccessfulAt: adAccount.hierarchySuccessfulAt,
			})

		const activeRuns = await transaction
			.select({ id: syncRun.id, slice: syncRun.slice })
			.from(syncRun)
			.where(
				and(
					eq(syncRun.agencyId, agencyId),
					inArray(syncRun.slice, ['account_data', 'hierarchy', 'insights', 'creative']),
					inArray(syncRun.status, ['queued', 'running']),
				),
			)
		const outcomes = activeRuns.flatMap(run =>
			recoveredAccounts
				.filter(
					account =>
						run.slice === 'account_data' ||
						run.slice === 'hierarchy' ||
						(account.accountDataSuccessfulAt !== null && account.hierarchySuccessfulAt !== null),
				)
				.map(account => ({
					id: randomUUID(),
					runId: run.id,
					adAccountId: account.id,
					slice: run.slice,
					status: 'queued' as const,
					diagnosticReference: `sync-run/${run.id}/${run.slice}/${account.id}`,
					createdAt: now,
					updatedAt: now,
				})),
		)
		if (outcomes.length > 0) await transaction.insert(syncAccountOutcome).values(outcomes).onConflictDoNothing()

		return { settings, recoveredAccountIds: recoveredAccounts.map(account => account.id) }
	})
}
