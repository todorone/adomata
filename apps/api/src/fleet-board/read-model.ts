import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../db'
import { ad, adAccount, adCreative, adInsight, adSet, campaign, client } from '../db/schema'
import type {
	FleetBoardHierarchyResponse,
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
	rollupMetricsForClient,
	signalLaneFor,
	sumDecimalStrings,
	summarizeClientHealth,
	summarizeFleetTier,
} from './domain'
import { logger } from '../core/logger'

export { mediaUrlForKey, normalizeCreative } from './creative'

const accountStaleMilliseconds = 10 * 60 * 1000
const insightsStaleMilliseconds = 2 * 60 * 60 * 1000
const actionItemsSchema = z.array(z.object({ action_type: z.string(), value: z.string().regex(/^-?\d+(?:\.\d+)?$/) }))
const purchaseActionTypes = new Set(['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'])

type AccountRow = typeof adAccount.$inferSelect
type ClientRow = typeof client.$inferSelect
type CampaignRow = typeof campaign.$inferSelect
type AdSetRow = typeof adSet.$inferSelect
type AdRow = typeof ad.$inferSelect
type Contribution = Parameters<typeof rollupKpis>[0][number]
type AccountView = FleetBoardRootResponse['accounts'][number]
type ClientView = FleetBoardRootResponse['clients'][number]

type FleetBoardModel = {
	accounts: AccountView[]
	clients: ClientView[]
	clientRowsById: Map<string, ClientRow>
	accountContributions: Map<string, Contribution[]>
	childNodes: {
		campaigns: Array<{ row: CampaignRow; kpis: AccountView['kpis'] }>
		adSets: Array<{ row: AdSetRow; kpis: AccountView['kpis'] }>
		ads: Array<{ row: AdRow; kpis: AccountView['kpis'] }>
	}
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
	const visibleClients = [...model.clientRowsById.values()]
		.filter(client => visibleAccounts.some(account => account.clientId === client.id))
		.map(client =>
			makeClientView(
				client,
				visibleAccounts.filter(account => account.clientId === client.id),
				model.accountContributions,
			),
		)
		.sort((left, right) => compareRootRows(left, right, query.sort, query.direction))
	const sortedAccounts = [...visibleAccounts].sort((left, right) =>
		compareRootRows(left, right, query.sort, query.direction),
	)
	return {
		clients: visibleClients,
		accounts: sortedAccounts,
		header: headerFreshness(sortedAccounts, query.range, now),
	}
}

export async function readFleetBoardChildren(
	agencyId: string,
	range: FleetBoardRange,
	parents: Array<{ type: 'account' | 'campaign' | 'adset'; id: string }>,
	now = new Date(),
): Promise<FleetBoardHierarchyResponse | null> {
	const model = await loadFleetBoardModel(agencyId, range, now)
	const accountIds = new Set(model.accounts.map(account => account.id))
	const campaignIds = new Set(model.childNodes.campaigns.map(node => node.row.id))
	const adSetIds = new Set(model.childNodes.adSets.map(node => node.row.id))
	if (
		parents.some(parent =>
			parent.type === 'account'
				? !accountIds.has(parent.id)
				: parent.type === 'campaign'
					? !campaignIds.has(parent.id)
					: !adSetIds.has(parent.id),
		)
	) {
		return null
	}
	const nodes: FleetBoardHierarchyResponse['nodes'] = []
	for (const parent of parents) {
		if (parent.type === 'account') {
			nodes.push(
				...model.childNodes.campaigns
					.filter(node => node.row.adAccountId === parent.id && node.row.deletedAt === null)
					.map(node => ({
						id: node.row.id,
						type: 'campaign' as const,
						parentId: parent.id,
						name: node.row.name,
						effectiveStatus: node.row.effectiveStatus,
						kpis: node.kpis,
					})),
			)
			continue
		}
		if (parent.type === 'campaign') {
			nodes.push(
				...model.childNodes.adSets
					.filter(node => node.row.campaignId === parent.id && node.row.deletedAt === null)
					.map(node => ({
						id: node.row.id,
						type: 'adset' as const,
						parentId: parent.id,
						name: node.row.name,
						effectiveStatus: node.row.effectiveStatus,
						kpis: node.kpis,
					})),
			)
			continue
		}
		nodes.push(
			...model.childNodes.ads
				.filter(node => node.row.adSetId === parent.id && node.row.deletedAt === null)
				.map(node => ({
					id: node.row.id,
					type: 'ad' as const,
					parentId: parent.id,
					name: node.row.name,
					effectiveStatus: node.row.effectiveStatus,
					kpis: node.kpis,
				})),
		)
	}
	return { nodes }
}

export async function readCreative(agencyId: string, adId: string) {
	const [row] = await db
		.select({ creative: adCreative, ad })
		.from(adCreative)
		.innerJoin(ad, eq(adCreative.adId, ad.id))
		.innerJoin(adSet, eq(ad.adSetId, adSet.id))
		.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
		.innerJoin(adAccount, eq(campaign.adAccountId, adAccount.id))
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.where(and(eq(client.agencyId, agencyId), eq(ad.id, adId)))
		.limit(1)
	if (!row) return null
	return { creative: row.creative, ad: row.ad }
}

async function loadFleetBoardModel(agencyId: string, range: FleetBoardRange, now: Date): Promise<FleetBoardModel> {
	const accountRows = await db
		.select({ account: adAccount, client })
		.from(adAccount)
		.innerJoin(client, eq(adAccount.clientId, client.id))
		.where(and(eq(client.agencyId, agencyId), isNull(client.deletedAt)))
	if (accountRows.length === 0) {
		return {
			accounts: [],
			clients: [],
			clientRowsById: new Map(),
			accountContributions: new Map(),
			childNodes: { campaigns: [], adSets: [], ads: [] },
		}
	}

	const accountsById = new Map(accountRows.map(row => [row.account.id, row]))
	const accountRanges = new Map(
		accountRows.map(({ account }) => [account.id, dateRangeForAccount(range, account.timezoneName ?? 'UTC', now)]),
	)
	const starts = [...accountRanges.values()].map(value => value.start)
	const ends = [...accountRanges.values()].map(value => value.end)
	const accountIds = [...accountsById.keys()]
	const hierarchyRows = await db
		.select({ ad, adSet, campaign })
		.from(ad)
		.innerJoin(adSet, eq(ad.adSetId, adSet.id))
		.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
		.where(inArray(campaign.adAccountId, accountIds))
	const insightRows = await db
		.select({ insight: adInsight, ad, adSet, campaign })
		.from(adInsight)
		.innerJoin(ad, eq(adInsight.adId, ad.id))
		.innerJoin(adSet, eq(ad.adSetId, adSet.id))
		.innerJoin(campaign, eq(adSet.campaignId, campaign.id))
		.where(
			and(
				inArray(campaign.adAccountId, accountIds),
				gte(adInsight.date, starts.sort()[0]!),
				lte(adInsight.date, ends.sort().at(-1)!),
			),
		)

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

	const allContributionsFor = (predicate: (row: (typeof hierarchyRows)[number]) => boolean) =>
		hierarchyRows.filter(predicate).flatMap(row => contributionsByAd.get(row.ad.id) ?? [])
	const kpisForAd = new Map(
		hierarchyRows.map(row => [row.ad.id, toApiKpis(rollupKpis(contributionsByAd.get(row.ad.id) ?? []))]),
	)
	const kpisForAdSet = new Map(
		hierarchyRows.map(row => [
			row.adSet.id,
			toApiKpis(rollupKpis(allContributionsFor(candidate => candidate.adSet.id === row.adSet.id))),
		]),
	)
	const kpisForCampaign = new Map(
		hierarchyRows.map(row => [
			row.campaign.id,
			toApiKpis(rollupKpis(allContributionsFor(candidate => candidate.campaign.id === row.campaign.id))),
		]),
	)
	const accountContributions = new Map(
		accountIds.map(id => [id, allContributionsFor(row => row.campaign.adAccountId === id)]),
	)

	const accounts = accountRows.map(({ account, client: accountClient }) =>
		accountView(account, accountClient, accountContributions.get(account.id) ?? [], now),
	)
	const clientRowsById = new Map(accountRows.map(row => [row.client.id, row.client]))
	const clients = [...clientRowsById.values()].map(clientRow => {
		const clientAccountViews = accounts.filter(account => account.clientId === clientRow.id)
		return makeClientView(clientRow, clientAccountViews, accountContributions)
	})
	return {
		accounts,
		clients,
		clientRowsById,
		accountContributions,
		childNodes: {
			campaigns: uniqueRows(
				hierarchyRows.map(row => ({ row: row.campaign, kpis: kpisForCampaign.get(row.campaign.id)! })),
			),
			adSets: uniqueRows(hierarchyRows.map(row => ({ row: row.adSet, kpis: kpisForAdSet.get(row.adSet.id)! }))),
			ads: hierarchyRows.map(row => ({ row: row.ad, kpis: kpisForAd.get(row.ad.id)! })),
		},
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
		amountOwed: account.balance,
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
				account.insightsTierRefreshedAt,
				account.insightsTierError !== null,
				insightsStaleMilliseconds,
				now,
			),
		},
	}
}

function makeClientView(
	clientRow: Pick<ClientRow, 'id' | 'name'>,
	accounts: AccountView[],
	accountContributions: Map<string, Contribution[]>,
): ClientView {
	const health = summarizeClientHealth(accounts.map(account => account.health))
	const input = accounts.flatMap(account =>
		(accountContributions.get(account.id) ?? []).map(contribution => ({
			...contribution,
			currency: account.currency,
		})),
	)
	const currencies = new Set(accounts.map(account => account.currency))
	const timezones = new Set(accounts.map(account => account.timezoneName))
	const kpis = rollupMetricsForClient(input)
	const owed = accounts.flatMap(account => (account.amountOwed === null ? [] : [account.amountOwed]))
	return {
		id: clientRow.id,
		name: clientRow.name,
		currency: currencies.size === 1 ? [...currencies][0]! : null,
		mixedCurrency: currencies.size > 1,
		mixedTimezone: timezones.size > 1,
		amountOwed: currencies.size > 1 || owed.length === 0 ? null : sumDecimalStrings(owed),
		health,
		signalsLane: signalLaneFor(health),
		kpis: toApiKpis(kpis),
		accountIds: accounts.map(account => account.id),
	}
}

function zeroContribution(adRow: AdRow): Contribution {
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

function toApiKpis(kpis: ReturnType<typeof rollupKpis> | ReturnType<typeof rollupMetricsForClient>) {
	return { ...kpis, unsupported: 'unsupported' in kpis ? kpis.unsupported : null }
}

function freshness(refreshedAt: Date | null, failed: boolean, threshold: number, now: Date) {
	return { refreshedAt: refreshedAt?.toISOString() ?? null, stale: isStale(refreshedAt, threshold, now), failed }
}

function headerFreshness(accounts: AccountView[], range: FleetBoardRange, now: Date) {
	const accountTier = summarizeFleetTier(accounts.map(account => account.freshness.accountTier))
	const insightsTier = summarizeFleetTier(accounts.map(account => account.freshness.insightsTier))
	return {
		accountTierRefreshedAt: accountTier.refreshedAt,
		insightsTierRefreshedAt: insightsTier.refreshedAt,
		accountTierStale: accountTier.stale,
		insightsTierStale: insightsTier.stale,
		accountTierNeverSynced: accountTier.neverSynced,
		insightsTierNeverSynced: insightsTier.neverSynced,
		provisional: accounts.some(account =>
			isProvisional(dateRangeForAccount(range, account.timezoneName, now), account.timezoneName, now),
		),
	}
}

function compareRootRows(
	left: AccountView | ClientView,
	right: AccountView | ClientView,
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

function rootSortValue(row: AccountView | ClientView, sort: FleetBoardRootQuery['sort']) {
	if (sort === 'attention') return Number(row.health.needsAttention)
	if (sort === 'name') return row.name
	if (sort === 'owed') return row.amountOwed === null ? -Infinity : Number(row.amountOwed)
	const value = row.kpis[sort]
	return value === null ? -Infinity : Number(value)
}

function uniqueRows<T extends { row: { id: string } }>(rows: T[]) {
	return [...new Map(rows.map(row => [row.row.id, row])).values()]
}
