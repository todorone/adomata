export const fakeMetaAgency = {
	id: 'fake-meta-agency',
	name: 'Meta Fixture Agency',
	slug: 'fake-meta-agency',
} as const

export const fakeMetaClients = [
	{ id: 'fake-meta-northstar', agencyId: fakeMetaAgency.id, name: 'Northstar Commerce' },
	{ id: 'fake-meta-meridian', agencyId: fakeMetaAgency.id, name: 'Meridian Services' },
] as const

type SuccessfulAccount = {
	id: string
	clientId: (typeof fakeMetaClients)[number]['id']
	name: string
	currency: string
	kind: 'success'
	accountStatus: number
	disableReason: number
	balance: string
	isPrepayAccount: boolean
	fundingSourceType: number | null
}

type FaultAccount = {
	id: string
	clientId: (typeof fakeMetaClients)[number]['id']
	name: string
	currency: string
	kind: 'throttle' | 'revoked'
}

export const fakeMetaAccounts: readonly (SuccessfulAccount | FaultAccount)[] = [
	{
		id: '100000000000001',
		clientId: 'fake-meta-northstar',
		name: 'Funded prepay',
		currency: 'USD',
		kind: 'success',
		accountStatus: 1,
		disableReason: 0,
		balance: '0',
		isPrepayAccount: true,
		fundingSourceType: 20,
	},
	{
		id: '100000000000002',
		clientId: 'fake-meta-northstar',
		name: 'Prepay with amount due',
		currency: 'USD',
		kind: 'success',
		accountStatus: 1,
		disableReason: 0,
		balance: '12345',
		isPrepayAccount: true,
		fundingSourceType: 20,
	},
	{
		id: '100000000000005',
		clientId: 'fake-meta-northstar',
		name: 'Throttled Account',
		currency: 'USD',
		kind: 'throttle',
	},
	{
		id: '100000000000003',
		clientId: 'fake-meta-meridian',
		name: 'Healthy credit-line',
		currency: 'USD',
		kind: 'success',
		accountStatus: 1,
		disableReason: 0,
		balance: '0',
		isPrepayAccount: false,
		fundingSourceType: 4,
	},
	{
		id: '100000000000004',
		clientId: 'fake-meta-meridian',
		name: 'Disabled for payment risk',
		currency: 'USD',
		kind: 'success',
		accountStatus: 2,
		disableReason: 3,
		balance: '0',
		isPrepayAccount: false,
		fundingSourceType: null,
	},
	{ id: '100000000000006', clientId: 'fake-meta-meridian', name: 'Revoked Account', currency: 'USD', kind: 'revoked' },
]

export async function seedFakeMetaRoster() {
	const [{ db }, { adAccount, client, organization }] = await Promise.all([
		import('../../db'),
		import('../../db/schema'),
	])
	const now = new Date()
	await db
		.insert(organization)
		.values({ ...fakeMetaAgency, createdAt: now, updatedAt: now })
		.onConflictDoUpdate({
			target: organization.id,
			set: { name: fakeMetaAgency.name, slug: fakeMetaAgency.slug, updatedAt: now },
		})

	for (const fixtureClient of fakeMetaClients) {
		await db
			.insert(client)
			.values({ ...fixtureClient, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: client.id,
				set: { agencyId: fixtureClient.agencyId, name: fixtureClient.name, updatedAt: now },
			})
	}

	for (const fixtureAccount of fakeMetaAccounts) {
		await db
			.insert(adAccount)
			.values({
				id: fixtureAccount.id,
				clientId: fixtureAccount.clientId,
				name: fixtureAccount.name,
				currency: fixtureAccount.currency,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: adAccount.id,
				set: {
					clientId: fixtureAccount.clientId,
					name: fixtureAccount.name,
					currency: fixtureAccount.currency,
					updatedAt: now,
				},
			})
	}
}
