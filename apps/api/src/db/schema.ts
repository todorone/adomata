import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

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
