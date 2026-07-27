import { describe, expect, it } from 'vitest'

import { buildWipeStatement } from '../db/wipe-statement'

describe('buildWipeStatement', () => {
	it('truncates every schema table with identity reset and cascade', () => {
		const statement = buildWipeStatement()

		expect(statement.startsWith('TRUNCATE TABLE ')).toBe(true)
		expect(statement).toContain('RESTART IDENTITY CASCADE')

		for (const table of [
			'user',
			'session',
			'account',
			'verification',
			'organization',
			'member',
			'invitation',
			'client',
			'ad_account',
			'campaign',
			'ad_set',
			'ad',
			'ad_creative',
			'ad_insight',
		]) {
			expect(statement).toContain(`"${table}"`)
		}
	})
})
