import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db'
import { ad, adAccount, adCreative, adInsight, adSet, campaign, client } from '../db/schema'
import type {
	FleetBoardNode,
	FleetBoardRange,
	FleetBoardRootQuery,
	FleetBoardRootResponse,
} from '../client/fleet-board'
import {
	classifyAccountHealth,
	dateRangeForAccount,
	isProvisional,
	isStale,
	rollupKpis,
	signalLaneFor,
	sumDecimalStrings,
	summarizeFleetTier,
} from './domain'
import { logger } from '../core/logger'

export {
	creativeHasVideo,
	mediaUrlForKey,
	needsCreativeMediaRefresh,
	needsCreativePreview,
	normalizeCreative,
} from './creative'

const accountStaleMilliseconds = 10 * 60 * 1000
const insightsStaleMilliseconds = 10 * 60 * 1000
const historicalReconciliationStaleMilliseconds = 36 * 60 * 60 * 1000
const actionItemsSchema = z.array(z.object({ action_type: z.string(), value: z.string().regex(/^-?\d+(?:\.\d+)?$/) }))
const purchaseActionTypes = new Set(['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'])

type AccountRow = typeof adAccount.$inferSelect
type ClientRow = typeof client.$inferSelect
type Contribution = Parameters<typeof rollupKpis>[0][number]
type AccountView = FleetBoardRootResponse['accounts'][number]
type ClientView = FleetBoardRootResponse['clients'][number]
type ModelNode = { accountId: string; node: FleetBoardNode }

type FleetBoardModel = {
	accounts: AccountView[]
	clients: ClientView[]
	nodes: ModelNode[]
}

const campaignNodeFields = {
	id: campaign.id,
	adAccountId: campaign.adAccountId,
	name: campaign.name,
	effectiveStatus: campaign.effectiveStatus,
	deletedAt: campaign.deletedAt,
}
const adSetNodeFields = {
	id: adSet.id,
	campaignId: adSet.campaignId,
	name: adSet.name,
	effectiveStatus: adSet.effectiveStatus,
	deletedAt: adSet.deletedAt,
}
const adNodeFields = {
	id: ad.id,
	adSetId: ad.adSetId,
	name: ad.name,
	effectiveStatus: ad.effectiveStatus,
	deletedAt: ad.deletedAt,
}

export async function readFleetBoardRoot(
	agencyId: string,
	query: FleetBoardRootQuery,
	now = new Date(),
): Promise<FleetBoardRootResponse> {
	const model = await loadFleetBoardModel(agencyId, query.range, now)
	const search = query.search.toLocaleLowerCase()
	const visibleAccounts = model.accounts.filter(account => {
		if (query.clientId && account.clientId !== query.clientId) return false
		if (query.needsAttention && !account.health.needsAttention) return false
		return !search || `${account.name} ${account.clientName}`.toLocaleLowerCase().includes(search)
	})
	const visibleClients = model.clients
		.filter(client => visibleAccounts.some(account => account.clientId === client.id))
		.sort((left, right) => left.name.localeCompare(right.name))
	const sortedAccounts = [...visibleAccounts].sort((left, right) =>
		compareRootRows(left, right, query.sort, query.direction),
	)
	const visibleAccountIds = new Set(sortedAccounts.map(account => account.id))
	return {
		clients: visibleClients,
		accounts: sortedAccounts,
		nodes: model.nodes.filter(node => visibleAccountIds.has(node.accountId)).map(node => node.node),
		header: headerFreshness(sortedAccounts, query.range, now),
	}
}

export async function readCreative(agencyId: string, adId: string) {
	const [row] = await db
		.select({ creative: adCreative, ad, adAccountId: adAccount.id })
		.from(adCreative)
		.innerJoin(ad, eq(adCreative.adId, ad.id))
		.innerJoin(adSet, eq(ad.adSetId, adSet.id))
		.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
		.innerJoin(adAccount, eq(campaign.adAccountId, adAccount.id))
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.where(and(eq(client.agencyId, agencyId), eq(ad.id, adId)))
		.limit(1)
	if (!row) return null
	return { creative: row.creative, ad: row.ad, adAccountId: row.adAccountId }
}

async function loadFleetBoardModel(agencyId: string, range: FleetBoardRange, now: Date): Promise<FleetBoardModel> {
	const accountRows = await db
		.select({ account: adAccount, client })
		.from(adAccount)
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.where(
			and(
				eq(client.agencyId, agencyId),
				isNull(client.deletedAt),
				or(
					eq(adAccount.connectionStatus, 'connected'),
					and(
						eq(adAccount.connectionStatus, 'access_lost'),
						isNotNull(adAccount.accountDataSuccessfulAt),
						isNotNull(adAccount.hierarchySuccessfulAt),
						isNotNull(adAccount.insightsSuccessfulAt),
						isNotNull(adAccount.initialImportHistoryCompletedAt),
					),
				),
			),
		)
	if (accountRows.length === 0) {
		return {
			accounts: [],
			clients: [],
			nodes: [],
		}
	}

	const accountsById = new Map(accountRows.map(row => [row.account.id, row]))
	const accountRanges = new Map(
		accountRows.map(({ account }) => [account.id, dateRangeForAccount(range, account.timezoneName ?? 'UTC', now)]),
	)
	const accountIds = [...accountsById.keys()]
	const rangeStart = [...accountRanges.values()].map(value => value.start).sort()[0]!
	const rangeEnd = [...accountRanges.values()]
		.map(value => value.end)
		.sort()
		.at(-1)!
	// Independent given `accountIds`: this is the only board read, so pay one round-trip, not five.
	const [campaignRows, adSetRows, hierarchyRows, creativeRows, insightRows] = await Promise.all([
		db.select({ campaign: campaignNodeFields }).from(campaign).where(inArray(campaign.adAccountId, accountIds)),
		db
			.select({
				adSet: adSetNodeFields,
				campaign: { adAccountId: campaign.adAccountId, deletedAt: campaign.deletedAt },
			})
			.from(adSet)
			.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
			.where(inArray(campaign.adAccountId, accountIds)),
		db
			.select({
				ad: adNodeFields,
				adSet: { id: adSet.id, deletedAt: adSet.deletedAt },
				campaign: { id: campaign.id, adAccountId: campaign.adAccountId, deletedAt: campaign.deletedAt },
			})
			.from(ad)
			.innerJoin(adSet, eq(ad.adSetId, adSet.id))
			.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
			.where(inArray(campaign.adAccountId, accountIds)),
		db
			.select({ adId: adCreative.adId, creativeId: adCreative.id, hasVideo: adCreative.hasVideo })
			.from(adCreative)
			.innerJoin(ad, eq(adCreative.adId, ad.id))
			.innerJoin(adSet, eq(ad.adSetId, adSet.id))
			.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
			.where(inArray(campaign.adAccountId, accountIds)),
		db
			.select({
				insight: adInsight,
				ad: { id: ad.id, effectiveStatus: ad.effectiveStatus, deletedAt: ad.deletedAt },
				adSet: { resultActionType: adSet.resultActionType },
				campaign: { adAccountId: campaign.adAccountId },
			})
			.from(adInsight)
			.innerJoin(ad, eq(adInsight.adId, ad.id))
			.innerJoin(adSet, eq(ad.adSetId, adSet.id))
			.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
			.where(
				and(
					inArray(campaign.adAccountId, accountIds),
					gte(adInsight.date, rangeStart),
					lte(adInsight.date, rangeEnd),
				),
			),
	])
	const creativeByAd = new Map(creativeRows.map(row => [row.adId, row]))

	const contributionsByAd = new Map<string, Contribution[]>()
	for (const row of hierarchyRows) {
		contributionsByAd.set(row.ad.id, [zeroContribution(row.ad)])
	}
	for (const row of insightRows) {
		const rangeForAccount = accountRanges.get(row.campaign.adAccountId)
		if (!rangeForAccount || row.insight.date < rangeForAccount.start || row.insight.date > rangeForAccount.end)
			continue
		const contributions = contributionsByAd.get(row.ad.id)
		if (!contributions) continue
		contributions.push(
			insightContribution(
				row.insight,
				row.adSet.resultActionType,
				row.ad.deletedAt === null && row.ad.effectiveStatus === 'ACTIVE',
			),
		)
	}

	const contributionsByAdSet = new Map<string, Contribution[]>()
	const contributionsByCampaign = new Map<string, Contribution[]>()
	const contributionsByAccount = new Map<string, Contribution[]>()
	for (const row of hierarchyRows) {
		const contributions = contributionsByAd.get(row.ad.id) ?? []
		appendContributions(contributionsByAdSet, row.adSet.id, contributions)
		appendContributions(contributionsByCampaign, row.campaign.id, contributions)
		appendContributions(contributionsByAccount, row.campaign.adAccountId, contributions)
	}

	const kpisForAd = new Map(
		hierarchyRows.map(row => [row.ad.id, toApiKpis(rollupKpis(contributionsByAd.get(row.ad.id) ?? []))]),
	)
	const kpisForAdSet = new Map(
		adSetRows.map(row => [row.adSet.id, toApiKpis(rollupKpis(contributionsByAdSet.get(row.adSet.id) ?? []))]),
	)
	const kpisForCampaign = new Map(
		campaignRows.map(row => [
			row.campaign.id,
			toApiKpis(rollupKpis(contributionsByCampaign.get(row.campaign.id) ?? [])),
		]),
	)

	const accounts = accountRows.map(({ account, client: accountClient }) =>
		accountView(account, accountClient, contributionsByAccount.get(account.id) ?? [], now),
	)
	const clients = [...new Map(accountRows.map(row => [row.client.id, row.client])).values()].map(client => ({
		id: client.id,
		name: client.name,
	}))
	return {
		accounts,
		clients,
		nodes: [
			...campaignRows
				.filter(row => row.campaign.deletedAt === null)
				.map(row => ({
					accountId: row.campaign.adAccountId,
					node: {
						id: row.campaign.id,
						type: 'campaign' as const,
						parentId: row.campaign.adAccountId,
						name: row.campaign.name,
						effectiveStatus: row.campaign.effectiveStatus,
						kpis: kpisForCampaign.get(row.campaign.id)!,
						creativeId: null,
						creativeHasVideo: false,
					},
				})),
			...adSetRows
				.filter(row => row.campaign.deletedAt === null && row.adSet.deletedAt === null)
				.map(row => ({
					accountId: row.campaign.adAccountId,
					node: {
						id: row.adSet.id,
						type: 'adset' as const,
						parentId: row.adSet.campaignId,
						name: row.adSet.name,
						effectiveStatus: row.adSet.effectiveStatus,
						kpis: kpisForAdSet.get(row.adSet.id)!,
						creativeId: null,
						creativeHasVideo: false,
					},
				})),
			...hierarchyRows
				.filter(row => row.campaign.deletedAt === null && row.adSet.deletedAt === null && row.ad.deletedAt === null)
				.map(row => {
					const creative = creativeByAd.get(row.ad.id)
					return {
						accountId: row.campaign.adAccountId,
						node: {
							id: row.ad.id,
							type: 'ad' as const,
							parentId: row.ad.adSetId,
							name: row.ad.name,
							effectiveStatus: row.ad.effectiveStatus,
							kpis: kpisForAd.get(row.ad.id)!,
							creativeId: creative?.creativeId ?? null,
							creativeHasVideo: creative?.hasVideo ?? false,
						},
					}
				}),
		],
	}
}

function accountView(
	account: AccountRow,
	accountClient: ClientRow,
	contributions: Contribution[],
	now: Date,
): AccountView {
	const health = classifyAccountHealth(
		{
			connectionStatus: account.connectionStatus,
			metaAccountStatus: account.metaAccountStatus,
			metaDisableReason: account.metaDisableReason,
			isPrepayAccount: account.isPrepayAccount,
		},
		event => logger.warn('Unknown Meta account enum in Fleet Board read', { accountId: account.id, ...event }),
	)
	return {
		id: account.id,
		type: 'account',
		clientId: accountClient.id,
		clientName: accountClient.name,
		name: account.name,
		currency: account.currency,
		timezoneName: account.timezoneName ?? 'UTC',
		connectionStatus: account.connectionStatus,
		health,
		signalsLane: signalLaneFor(health),
		kpis: toApiKpis(rollupKpis(contributions)),
		freshness: {
			accountTier: freshness(
				account.accountTierRefreshedAt,
				account.lastPollError !== null,
				accountStaleMilliseconds,
				now,
			),
			insightsTier: freshness(
				account.insightsSuccessfulAt ?? account.insightsTierRefreshedAt,
				(account.insightsError ?? account.insightsTierError ?? null) !== null,
				insightsStaleMilliseconds,
				now,
			),
			historicalReconciliation: freshness(
				account.historicalReconciliationSuccessfulAt,
				account.historicalReconciliationError !== null,
				historicalReconciliationStaleMilliseconds,
				now,
			),
		},
	}
}

function appendContributions(target: Map<string, Contribution[]>, key: string, contributions: Contribution[]) {
	const existing = target.get(key)
	if (existing) existing.push(...contributions)
	else target.set(key, [...contributions])
}

function zeroContribution(adRow: { deletedAt: Date | null; effectiveStatus: string }): Contribution {
	return {
		spend: '0',
		impressions: 0,
		inlineLinkClicks: 0,
		resultActionType: null,
		resultCount: null,
		purchaseValue: '0',
		running: adRow.deletedAt === null && adRow.effectiveStatus === 'ACTIVE',
	}
}

function insightContribution(
	insight: typeof adInsight.$inferSelect,
	resultActionType: string | null,
	running: boolean,
): Contribution {
	const actions = parsedActionItems(insight.actions)
	const values = parsedActionItems(insight.actionValues)
	return {
		spend: insight.spend,
		impressions: insight.impressions,
		inlineLinkClicks: insight.inlineLinkClicks,
		resultActionType,
		resultCount: resultActionType
			? sumDecimalStrings(
					actions.filter(action => action.action_type === resultActionType).map(action => action.value),
				)
			: null,
		purchaseValue: sumDecimalStrings(
			values.filter(action => purchaseActionTypes.has(action.action_type)).map(action => action.value),
		),
		running,
	}
}

function parsedActionItems(input: unknown) {
	const parsed = actionItemsSchema.safeParse(input)
	return parsed.success ? parsed.data : []
}

function toApiKpis(kpis: ReturnType<typeof rollupKpis>) {
	return kpis
}

function freshness(refreshedAt: Date | null, failed: boolean, threshold: number, now: Date) {
	return { refreshedAt: refreshedAt?.toISOString() ?? null, stale: isStale(refreshedAt, threshold, now), failed }
}

function headerFreshness(accounts: AccountView[], range: FleetBoardRange, now: Date) {
	const accountTier = summarizeFleetTier(accounts.map(account => account.freshness.accountTier))
	const insightsTier = summarizeFleetTier(accounts.map(account => account.freshness.insightsTier))
	const historicalReconciliation = summarizeFleetTier(
		accounts.map(account => account.freshness.historicalReconciliation),
	)
	return {
		accountTierRefreshedAt: accountTier.refreshedAt,
		insightsTierRefreshedAt: insightsTier.refreshedAt,
		historicalReconciliationRefreshedAt: historicalReconciliation.refreshedAt,
		accountTierStale: accountTier.stale,
		insightsTierStale: insightsTier.stale,
		historicalReconciliationStale: historicalReconciliation.stale,
		accountTierNeverSynced: accountTier.neverSynced,
		insightsTierNeverSynced: insightsTier.neverSynced,
		historicalReconciliationNeverSynced: historicalReconciliation.neverSynced,
		provisional: accounts.some(account =>
			isProvisional(dateRangeForAccount(range, account.timezoneName, now), account.timezoneName, now),
		),
	}
}

function compareRootRows(
	left: AccountView,
	right: AccountView,
	sort: FleetBoardRootQuery['sort'],
	direction: FleetBoardRootQuery['direction'],
) {
	const leftValue = rootSortValue(left, sort)
	const rightValue = rootSortValue(right, sort)
	const result =
		typeof leftValue === 'string' && typeof rightValue === 'string'
			? leftValue.localeCompare(rightValue)
			: Number(leftValue) - Number(rightValue)
	return direction === 'asc' ? result : -result
}

function rootSortValue(row: AccountView, sort: FleetBoardRootQuery['sort']) {
	if (sort === 'attention') return Number(row.health.needsAttention)
	if (sort === 'name') return row.name
	const value = row.kpis[sort]
	return value === null ? -Infinity : Number(value)
}
