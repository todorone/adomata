import { getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

import * as schema from './schema'

// Derive the table list from the schema, so a new application table is
// automatically included in the factory reset.
export function buildWipeStatement(): string {
	const tables = [
		...new Set(
			Object.values(schema)
				.filter(value => is(value, PgTable))
				.map(getTableName),
		),
	]
	const identifiers = tables.map(name => `"${name}"`).join(', ')
	return `TRUNCATE TABLE ${identifiers} RESTART IDENTITY CASCADE`
}
