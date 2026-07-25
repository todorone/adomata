import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'

import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
	throw new Error('DATABASE_URL is not set')
}

export const sql = new SQL({ url: connectionString, max: 10, idleTimeout: 30, connectionTimeout: 10 })

export const db = drizzle({ client: sql, schema, casing: 'snake_case' })

export type Db = typeof db
