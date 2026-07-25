import { index, sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Better Auth: core user accounts
export const users = sqliteTable(
	'user',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		email: text('email').notNull(),
		emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
		image: text('image'),
		createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
	},
	table => [uniqueIndex('user_email_idx').on(table.email)],
)

// Better Auth: user sessions with bearer tokens; extended with activeOrganizationId
export const sessions = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
		token: text('token').notNull(),
		createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
		ipAddress: text('ipAddress'),
		userAgent: text('userAgent'),
		activeOrganizationId: text('activeOrganizationId'),
		userId: text('userId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
	},
	table => [uniqueIndex('session_token_idx').on(table.token), index('session_userId_idx').on(table.userId)],
)

// Better Auth: OAuth provider credentials and tokens (Google, Apple)
export const accounts = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('accountId').notNull(),
		providerId: text('providerId').notNull(),
		userId: text('userId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		accessToken: text('accessToken'),
		refreshToken: text('refreshToken'),
		idToken: text('idToken'),
		accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
		refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
		scope: text('scope'),
		password: text('password'),
		createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
	},
	table => [index('account_userId_idx').on(table.userId)],
)

// Better Auth: temporary codes for email verification flow
export const verifications = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
		createdAt: integer('createdAt', { mode: 'timestamp_ms' }),
		updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }),
	},
	table => [index('verification_identifier_idx').on(table.identifier)],
)

export const user = users
export const session = sessions
export const account = accounts
export const verification = verifications

// Better Auth (organization plugin): tenant organizations — represents Adomata's Agency; slug is the public identifier
export const organization = sqliteTable('organization', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	slug: text('slug').unique(),
	logo: text('logo'),
	metadata: text('metadata'),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }),
})

// Better Auth (organization plugin): links users to organizations with a role
export const member = sqliteTable(
	'member',
	{
		id: text('id').primaryKey(),
		organizationId: text('organizationId')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		userId: text('userId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
		createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	},
	table => [
		index('member_organizationId_idx').on(table.organizationId),
		index('member_userId_idx').on(table.userId),
		uniqueIndex('member_userId_organizationId_idx').on(table.userId, table.organizationId),
	],
)

// Better Auth (organization plugin): pending/accepted/rejected org invites sent by email
export const invitation = sqliteTable(
	'invitation',
	{
		id: text('id').primaryKey(),
		organizationId: text('organizationId')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
		status: text('status', { enum: ['pending', 'accepted', 'rejected', 'canceled'] }).notNull(),
		expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(),
		createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
		inviterId: text('inviterId')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
	},
	table => [
		index('invitation_organizationId_idx').on(table.organizationId),
		index('invitation_email_status_idx').on(table.email, table.status),
	],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
