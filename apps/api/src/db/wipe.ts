import { buildWipeStatement } from './wipe-statement'

export async function wipeDatabase(): Promise<void> {
	const { sql } = await import('./index')
	await sql.unsafe(buildWipeStatement())
}
