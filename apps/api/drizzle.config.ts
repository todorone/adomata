import { defineConfig } from 'drizzle-kit'

// `generate` diffs against the committed snapshot and needs no DB connection;
// dbCredentials is only used by commands that actually connect (e.g. studio).
export default defineConfig({
	dialect: 'postgresql',
	schema: './src/db/schema.ts',
	out: './drizzle',
	casing: 'snake_case',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? '',
	},
	strict: true,
	verbose: true,
})
