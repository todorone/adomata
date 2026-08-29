import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { db } from '../db'
import { adAccount, client, organizationSettings } from '../db/schema'

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

		return { settings, recoveredAccountIds: recoveredAccounts.map(account => account.id) }
	})
}
