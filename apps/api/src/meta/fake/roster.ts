import { eq } from 'drizzle-orm'

const hqSlug = 'hq'

export const fakeMetaAgency = {
	id: 'fake-meta-agency',
	name: 'Meta Fixture Agency',
	slug: 'fake-meta-agency',
} as const

export const fakeMetaClients = [
	{ id: 'fake-meta-northstar', name: 'Northstar Commerce' },
	{ id: 'fake-meta-meridian', name: 'Meridian Services' },
	{ id: 'fake-meta-orbit', name: 'Orbit Studio' },
] as const

type SuccessfulAccount = {
	id: string
	clientId: (typeof fakeMetaClients)[number]['id']
	name: string
	currency: string
	timezoneName: string
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
	timezoneName: string
	kind: 'throttle' | 'revoked'
}

export type FakeMetaAccount = SuccessfulAccount | FaultAccount

export const fakeMetaAccounts: readonly FakeMetaAccount[] = [
	{
		id: 'act_100000000000001',
		clientId: 'fake-meta-northstar',
		name: 'Funded prepay',
		currency: 'USD',
		timezoneName: 'Europe/Kyiv',
		kind: 'success',
		accountStatus: 1,
		disableReason: 0,
		balance: '0',
		isPrepayAccount: true,
		fundingSourceType: 20,
	},
	{
		id: 'act_100000000000002',
		clientId: 'fake-meta-northstar',
		name: 'Prepay with amount due',
		currency: 'USD',
		timezoneName: 'America/Los_Angeles',
		kind: 'success',
		accountStatus: 1,
		disableReason: 0,
		balance: '12345',
		isPrepayAccount: true,
		fundingSourceType: 20,
	},
	{
		id: 'act_100000000000005',
		clientId: 'fake-meta-northstar',
		name: 'Throttled Account',
		currency: 'USD',
		timezoneName: 'Europe/Kyiv',
		kind: 'throttle',
	},
	{
		id: 'act_100000000000003',
		clientId: 'fake-meta-meridian',
		name: 'Healthy credit-line',
		currency: 'USD',
		timezoneName: 'Europe/Kyiv',
		kind: 'success',
		accountStatus: 1,
		disableReason: 0,
		balance: '0',
		isPrepayAccount: false,
		fundingSourceType: 4,
	},
	{
		id: 'act_100000000000004',
		clientId: 'fake-meta-meridian',
		name: 'Disabled for payment risk',
		currency: 'USD',
		timezoneName: 'Europe/Kyiv',
		kind: 'success',
		accountStatus: 2,
		disableReason: 3,
		balance: '0',
		isPrepayAccount: false,
		fundingSourceType: null,
	},
	{
		id: 'act_100000000000006',
		clientId: 'fake-meta-meridian',
		name: 'Revoked Account',
		currency: 'USD',
		timezoneName: 'Europe/Kyiv',
		kind: 'revoked',
	},
	{
		id: 'act_100000000000007',
		clientId: 'fake-meta-orbit',
		name: 'Empty account',
		currency: 'EUR',
		timezoneName: 'America/New_York',
		kind: 'success',
		accountStatus: 1,
		disableReason: 0,
		balance: '0',
		isPrepayAccount: true,
		fundingSourceType: 20,
	},
]

export type FakeCampaign = {
	id: string
	adAccountId: string
	name: string
	effectiveStatus: string
	objective: string | null
}
export type FakeAdSet = {
	id: string
	campaignId: string
	name: string
	effectiveStatus: string
	optimizationGoal: string | null
	promotedObject: Record<string, unknown> | null
}
export type FakeAd = { id: string; adSetId: string; name: string; effectiveStatus: string }
export type FakeCreative = { id: string; adId: string; name: string; payload: Record<string, unknown> }
export type FakeInsight = {
	adId: string
	date: string
	spend: string
	impressions: string
	inlineLinkClicks: string
	actions: Array<{ action_type: string; value: string }>
	actionValues: Array<{ action_type: string; value: string }>
}

export const fakeMetaCampaigns: readonly FakeCampaign[] = [
	{
		id: 'campaign-001',
		adAccountId: 'act_100000000000001',
		name: 'Lead launch',
		effectiveStatus: 'ACTIVE',
		objective: 'OUTCOME_LEADS',
	},
	{
		id: 'campaign-002',
		adAccountId: 'act_100000000000001',
		name: 'Paused catalog',
		effectiveStatus: 'PAUSED',
		objective: 'OUTCOME_SALES',
	},
	{
		id: 'campaign-003',
		adAccountId: 'act_100000000000002',
		name: 'West coast leads',
		effectiveStatus: 'ACTIVE',
		objective: 'OUTCOME_LEADS',
	},
	{
		id: 'campaign-004',
		adAccountId: 'act_100000000000003',
		name: 'Postpay sales',
		effectiveStatus: 'ACTIVE',
		objective: 'OUTCOME_SALES',
	},
	{
		id: 'campaign-005',
		adAccountId: 'act_100000000000004',
		name: 'Risk review',
		effectiveStatus: 'PAUSED',
		objective: 'OUTCOME_LEADS',
	},
]

export const fakeMetaAdSets: readonly FakeAdSet[] = [
	{
		id: 'adset-001',
		campaignId: 'campaign-001',
		name: 'Lead form',
		effectiveStatus: 'ACTIVE',
		optimizationGoal: 'LEAD_GENERATION',
		promotedObject: null,
	},
	{
		id: 'adset-002',
		campaignId: 'campaign-002',
		name: 'Catalog purchase',
		effectiveStatus: 'PAUSED',
		optimizationGoal: 'OFFSITE_CONVERSIONS',
		promotedObject: null,
	},
	{
		id: 'adset-003',
		campaignId: 'campaign-003',
		name: 'Mixed result source',
		effectiveStatus: 'ACTIVE',
		optimizationGoal: null,
		promotedObject: null,
	},
	{
		id: 'adset-004',
		campaignId: 'campaign-004',
		name: 'Purchase',
		effectiveStatus: 'ACTIVE',
		optimizationGoal: 'VALUE',
		promotedObject: null,
	},
	{
		id: 'adset-005',
		campaignId: 'campaign-005',
		name: 'Disabled',
		effectiveStatus: 'PAUSED',
		optimizationGoal: 'LEAD_GENERATION',
		promotedObject: null,
	},
]

export const fakeMetaAds: readonly FakeAd[] = [
	{ id: 'ad-001', adSetId: 'adset-001', name: 'Image lead', effectiveStatus: 'ACTIVE' },
	{ id: 'ad-002', adSetId: 'adset-001', name: 'Carousel lead', effectiveStatus: 'ACTIVE' },
	{ id: 'ad-003', adSetId: 'adset-002', name: 'Video catalog', effectiveStatus: 'PAUSED' },
	{ id: 'ad-004', adSetId: 'adset-003', name: 'Asset feed', effectiveStatus: 'ACTIVE' },
	{ id: 'ad-005', adSetId: 'adset-004', name: 'Existing post', effectiveStatus: 'ACTIVE' },
	{ id: 'ad-006', adSetId: 'adset-005', name: 'Expired media', effectiveStatus: 'PAUSED' },
]

export const fakeMetaCreatives: readonly FakeCreative[] = [
	{
		id: 'creative-001',
		adId: 'ad-001',
		name: 'Image creative',
		payload: {
			image_url: 'https://media.example.test/image-001.jpg',
			object_story_spec: {
				link_data: { message: 'Image message', name: 'Image headline', call_to_action: { type: 'LEARN_MORE' } },
			},
		},
	},
	{
		id: 'creative-002',
		adId: 'ad-002',
		name: 'Carousel creative',
		payload: {
			object_story_spec: {
				link_data: {
					child_attachments: [
						{ name: 'Card 1', picture: 'https://media.example.test/card-1.jpg' },
						{ name: 'Card 2', picture: 'https://media.example.test/card-2.jpg' },
					],
				},
			},
		},
	},
	{
		id: 'creative-003',
		adId: 'ad-003',
		name: 'Video creative',
		payload: { video_id: 'video-003', thumbnail_url: 'https://media.example.test/video-003.jpg' },
	},
	{
		id: 'creative-004',
		adId: 'ad-004',
		name: 'Asset feed creative',
		payload: {
			asset_feed_spec: { images: [{ hash: 'asset-1' }, { hash: 'asset-2' }], videos: [{ video_id: 'video-004' }] },
		},
	},
	{
		id: 'creative-005',
		adId: 'ad-005',
		name: 'Existing post creative',
		payload: {
			object_story_spec: { page_id: 'page-005', instagram_actor_id: 'ig-005' },
			object_url: 'https://www.facebook.com/page/posts/005',
		},
	},
	{
		id: 'creative-006',
		adId: 'ad-006',
		name: 'Expired media creative',
		payload: { image_url: 'https://media.example.test/expired-006.jpg' },
	},
]

const dates = Array.from({ length: 31 }, (_, index) => {
	const date = new Date('2026-06-26T00:00:00.000Z')
	date.setUTCDate(date.getUTCDate() + index)
	return date.toISOString().slice(0, 10)
})

export const fakeMetaInsights: readonly FakeInsight[] = dates.flatMap((date, index) =>
	fakeMetaAds.map((ad, adIndex) => ({
		adId: ad.id,
		date,
		spend: `${(adIndex + 1) * 10}.${String(index % 10).padStart(2, '0')}`,
		impressions: String((adIndex + 1) * 100 + index),
		inlineLinkClicks: String(adIndex + 1),
		actions:
			ad.id === 'ad-004'
				? []
				: [
						{
							action_type: ad.id === 'ad-003' || ad.id === 'ad-005' ? 'purchase' : 'lead',
							value: String(adIndex + 1),
						},
					],
		actionValues:
			ad.id === 'ad-003' || ad.id === 'ad-005'
				? [{ action_type: 'purchase', value: String((adIndex + 1) * 20) }]
				: [],
	})),
)

export function createFakeMetaScaleRoster() {
	return Array.from({ length: 50 }, (_, clientIndex) => ({
		id: `scale-client-${clientIndex + 1}`,
		name: `Scale Client ${clientIndex + 1}`,
		accounts: Array.from({ length: 3 }, (_, accountIndex) => `act_scale_${clientIndex + 1}_${accountIndex + 1}`),
	}))
}

export async function seedFakeMetaRoster(agencyId?: string) {
	const [{ db }, { adAccount, client, organization }] = await Promise.all([
		import('../../db'),
		import('../../db/schema'),
	])
	const targetAgencyId =
		agencyId ??
		(await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, hqSlug)).limit(1))[0]?.id
	if (!targetAgencyId)
		throw new Error('HQ Agency does not exist; sign in as the superuser before seeding fake Meta data')

	const now = new Date()

	for (const fixtureClient of fakeMetaClients) {
		await db
			.insert(client)
			.values({ ...fixtureClient, agencyId: targetAgencyId, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: client.id,
				set: { agencyId: targetAgencyId, name: fixtureClient.name, updatedAt: now },
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
				timezoneName: fixtureAccount.timezoneName,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: adAccount.id,
				set: {
					clientId: fixtureAccount.clientId,
					name: fixtureAccount.name,
					currency: fixtureAccount.currency,
					timezoneName: fixtureAccount.timezoneName,
					updatedAt: now,
				},
			})
	}
}
