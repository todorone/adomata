import {
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core'

// Better Auth: core user accounts
export const users = pgTable(
	'user',
	{
		id: text().primaryKey(),
		name: text().notNull(),
		email: text().notNull(),
		emailVerified: boolean().notNull().default(false),
		image: text(),
		createdAt: timestamp({ withTimezone: true }).notNull(),
		updatedAt: timestamp({ withTimezone: true }).notNull(),
	},
	table => [uniqueIndex('user_email_idx').on(table.email)],
)

// Better Auth: user sessions with bearer tokens; extended with activeOrganizationId
export const sessions = pgTable(
	'session',
	{
		id: text().primaryKey(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		token: text().notNull(),
		createdAt: timestamp({ withTimezone: true }).notNull(),
		updatedAt: timestamp({ withTimezone: true }).notNull(),
		ipAddress: text(),
		userAgent: text(),
		activeOrganizationId: text(),
		userId: text()
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
	},
	table => [uniqueIndex('session_token_idx').on(table.token), index('session_user_id_idx').on(table.userId)],
)

// Better Auth: OAuth provider credentials and tokens (Google, Apple)
export const accounts = pgTable(
	'account',
	{
		id: text().primaryKey(),
		accountId: text().notNull(),
		providerId: text().notNull(),
		userId: text()
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		accessToken: text(),
		refreshToken: text(),
		idToken: text(),
		accessTokenExpiresAt: timestamp({ withTimezone: true }),
		refreshTokenExpiresAt: timestamp({ withTimezone: true }),
		scope: text(),
		password: text(),
		createdAt: timestamp({ withTimezone: true }).notNull(),
		updatedAt: timestamp({ withTimezone: true }).notNull(),
	},
	table => [index('account_user_id_idx').on(table.userId)],
)

// Better Auth: temporary codes for email verification flow
export const verifications = pgTable(
	'verification',
	{
		id: text().primaryKey(),
		identifier: text().notNull(),
		value: text().notNull(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }),
		updatedAt: timestamp({ withTimezone: true }),
	},
	table => [index('verification_identifier_idx').on(table.identifier)],
)

export const user = users
export const session = sessions
export const account = accounts
export const verification = verifications

// Better Auth (organization plugin): tenant organizations — represents Adomata's Agency; slug is the public identifier
export const organization = pgTable('organization', {
	id: text().primaryKey(),
	name: text().notNull(),
	slug: text().unique(),
	logo: text(),
	metadata: text(),
	createdAt: timestamp({ withTimezone: true }).notNull(),
	updatedAt: timestamp({ withTimezone: true }),
})

// Better Auth (organization plugin): links users to organizations with a role
export const member = pgTable(
	'member',
	{
		id: text().primaryKey(),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		userId: text()
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text({ enum: ['owner', 'admin', 'member'] }).notNull(),
		createdAt: timestamp({ withTimezone: true }).notNull(),
	},
	table => [
		index('member_organization_id_idx').on(table.organizationId),
		index('member_user_id_idx').on(table.userId),
		uniqueIndex('member_user_id_organization_id_idx').on(table.userId, table.organizationId),
	],
)

// Better Auth (organization plugin): pending/accepted/rejected org invites sent by email
export const invitation = pgTable(
	'invitation',
	{
		id: text().primaryKey(),
		organizationId: text()
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		email: text().notNull(),
		role: text({ enum: ['owner', 'admin', 'member'] }).notNull(),
		status: text({ enum: ['pending', 'accepted', 'rejected', 'canceled'] }).notNull(),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		createdAt: timestamp({ withTimezone: true }).notNull(),
		inviterId: text()
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
	},
	table => [
		index('invitation_organization_id_idx').on(table.organizationId),
		index('invitation_email_status_idx').on(table.email, table.status),
	],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

// Per-Agency Meta credentials (ADR 0028). Deliberate exception to the
// Agency-not-Organization naming convention — do not generalize this naming
// elsewhere. metaAccessToken is plaintext (matches account.accessToken) and
// write-only from the client's perspective; only the owner role may read/edit it.
export const organizationSettings = pgTable('organization_settings', {
	id: text().primaryKey(),
	organizationId: text()
		.notNull()
		.unique()
		.references(() => organization.id, { onDelete: 'cascade' }),
	metaAccessToken: text(),
	lastValidatedAt: timestamp({ withTimezone: true }),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export type OrganizationSettings = typeof organizationSettings.$inferSelect
export type NewOrganizationSettings = typeof organizationSettings.$inferInsert

// Fleet Board: Adomata-owned end-brand, scoped under an Agency (see CONTEXT.md — Client)
export const client = pgTable(
	'client',
	{
		id: text().primaryKey(),
		agencyId: text()
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		name: text().notNull(),
		deletedAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	table => [index('client_agency_id_idx').on(table.agencyId)],
)

export type Client = typeof client.$inferSelect
export type NewClient = typeof client.$inferInsert

// Fleet Board: a Meta Ad Account, scoped to exactly one Client (ADR 0006). PK is Meta's own
// account id (ADR 0009). connectionStatus/healthColor are Adomata's own derived state, distinct
// from the raw Meta health fields alongside them (see CONTEXT.md — Ad Account, Account Health).
export const adAccount = pgTable(
	'ad_account',
	{
		id: text().primaryKey(),
		clientId: text()
			.notNull()
			.references(() => client.id, { onDelete: 'cascade' }),
		name: text().notNull(),
		currency: text().notNull(),
		// Meta's IANA timezone is nullable during the compatibility rollout. Account-local
		// ranges fall back safely until every existing account has completed a new sync.
		timezoneName: text(),
		connectionStatus: text({ enum: ['pending', 'connected', 'access_lost'] })
			.notNull()
			.default('pending'),
		// Set on any failed poll; does not by itself change connectionStatus — only a real
		// auth/permission failure does. Distinguishes a rate-limit/5xx hiccup from access loss.
		lastPollAttemptAt: timestamp({ withTimezone: true }),
		lastPollError: text(),
		insightsTierAttemptAt: timestamp({ withTimezone: true }),
		insightsTierError: text(),
		accountTierRefreshedAt: timestamp({ withTimezone: true }),
		insightsTierRefreshedAt: timestamp({ withTimezone: true }),
		// Raw Meta account-health fields, vendor-mirrored (null until the first successful poll)
		metaAccountStatus: integer(),
		metaDisableReason: integer(),
		balance: text(),
		isPrepayAccount: boolean(),
		fundingSourceType: integer(),
		// Adomata's own derived traffic light, recomputed from the raw fields above on every poll
		healthColor: text({ enum: ['green', 'yellow', 'red'] }),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	table => [index('ad_account_client_id_idx').on(table.clientId)],
)

export type AdAccount = typeof adAccount.$inferSelect
export type NewAdAccount = typeof adAccount.$inferInsert

// Fleet Board: Meta's own Campaign, vendor-mirrored (see CONTEXT.md — Campaign / Ad Set / Ad).
// PK is Meta's own campaign id (ADR 0009). deletedAt is set, never cleared, when a sync no
// longer sees this object (ADR 0011) — rows are never hard-deleted.
export const campaign = pgTable(
	'campaign',
	{
		id: text().primaryKey(),
		adAccountId: text()
			.notNull()
			.references(() => adAccount.id, { onDelete: 'cascade' }),
		name: text().notNull(),
		effectiveStatus: text().notNull(),
		objective: text(),
		deletedAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	table => [index('campaign_ad_account_id_idx').on(table.adAccountId)],
)

export type Campaign = typeof campaign.$inferSelect
export type NewCampaign = typeof campaign.$inferInsert

// Fleet Board: Meta's own Ad Set, vendor-mirrored. PK is Meta's own ad set id (ADR 0009).
// optimizationGoal drives which action_type an ad's CPA/ROAS is computed against (ADR 0010).
export const adSet = pgTable(
	'ad_set',
	{
		id: text().primaryKey(),
		campaignId: text()
			.notNull()
			.references(() => campaign.id, { onDelete: 'cascade' }),
		name: text().notNull(),
		effectiveStatus: text().notNull(),
		optimizationGoal: text(),
		resultActionType: text(),
		deletedAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	table => [index('ad_set_campaign_id_idx').on(table.campaignId)],
)

export type AdSet = typeof adSet.$inferSelect
export type NewAdSet = typeof adSet.$inferInsert

// Fleet Board: Meta's own Ad, vendor-mirrored. PK is Meta's own ad id (ADR 0009). The tree
// stops here — Creative is this row's property, not a fifth level (ADR 0007).
export const ad = pgTable(
	'ad',
	{
		id: text().primaryKey(),
		adSetId: text()
			.notNull()
			.references(() => adSet.id, { onDelete: 'cascade' }),
		name: text().notNull(),
		effectiveStatus: text().notNull(),
		deletedAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	table => [index('ad_ad_set_id_idx').on(table.adSetId)],
)

export type Ad = typeof ad.$inferSelect
export type NewAd = typeof ad.$inferInsert

// Fleet Board: an Ad's Creative, 1:1 (see CONTEXT.md — Creative; ADR 0007). PK is Meta's own
// creative id (ADR 0009). payload holds the format-specific content (single image, carousel
// child_attachments, Advantage+ asset_feed_spec) — too variable in shape to normalize into columns.
export const adCreative = pgTable(
	'ad_creative',
	{
		id: text().primaryKey(),
		adId: text()
			.notNull()
			.references(() => ad.id, { onDelete: 'cascade' }),
		name: text(),
		payload: jsonb().notNull(),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	table => [uniqueIndex('ad_creative_ad_id_idx').on(table.adId)],
)

export type AdCreative = typeof adCreative.$inferSelect
export type NewAdCreative = typeof adCreative.$inferInsert

// Fleet Board: one Ad's Insights for one day — the only grain Insights are stored at (ADR 0010).
// Campaign/Ad Set/Ad Account/Client numbers are always a computed rollup over these rows, never
// a separate Meta call. actions/actionValues keep Meta's raw arrays so CPA/ROAS can pick the right
// action_type per campaign at read time, rather than baking in one fixed type at ingestion.
// Today's row is Provisional; older rows are Final once they age out of the Reconciliation Window
// (see CONTEXT.md — Provisional, Reconciliation Window) — both are derived from `date`, not stored.
export const adInsight = pgTable(
	'ad_insight',
	{
		adId: text()
			.notNull()
			.references(() => ad.id, { onDelete: 'cascade' }),
		date: date().notNull(),
		spend: text().notNull(),
		impressions: integer().notNull(),
		inlineLinkClicks: integer().notNull().default(0),
		// Retained only for a compatibility re-sync. Fleet Board reads inlineLinkClicks.
		clicks: integer().notNull(),
		actions: jsonb().notNull(),
		actionValues: jsonb().notNull(),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	table => [
		primaryKey({ columns: [table.adId, table.date] }),
		index('ad_insight_date_ad_id_idx').on(table.date, table.adId),
	],
)

export type AdInsight = typeof adInsight.$inferSelect
export type NewAdInsight = typeof adInsight.$inferInsert
