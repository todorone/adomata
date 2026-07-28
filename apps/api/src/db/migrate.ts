import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
	console.error('migration failed: DATABASE_URL is not set')
	process.exit(1)
}

// Dedicated single-use connection, separate from the app's pool. A one-shot
// migration process should not spin up the runtime pool, and a single
// connection is the recommended setup for applying migrations.
const sql = new SQL({ url: connectionString, max: 1 })
const db = drizzle({ client: sql })

let failed = false

try {
	await migrate(db, { migrationsFolder: './drizzle' })
	console.log('migrations applied')

	// Self-healing backfill: keeps the configured superadmin's role in sync with
	// SUPERADMIN_EMAIL, so promoting the column from an env-var check never locks
	// out an already-existing account (e.g. right after this migration first runs).
	if (process.env.SUPERADMIN_EMAIL) {
		await sql`UPDATE "user" SET role = 'super' WHERE lower(email) = lower(${process.env.SUPERADMIN_EMAIL})`
	}
} catch (err) {
	console.error('migration failed:', err)
	failed = true
} finally {
	await sql.end()
}

process.exit(failed ? 1 : 0)
