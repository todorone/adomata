import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
	console.error('migration failed: DATABASE_URL is not set')
	process.exit(1)
}

const sql = new SQL({ url: connectionString, max: 1 })
const db = drizzle({ client: sql })

let failed = false

try {
	await migrate(db, { migrationsFolder: './drizzle' })
	console.log('migrations applied')
} catch (err) {
	console.error('migration failed:', err)
	failed = true
} finally {
	await sql.end()
}

process.exit(failed ? 1 : 0)
