import { afterEach, describe, expect, it } from 'vitest'

import {
	defaultColumnLayout,
	getColumnLayoutStorageKey,
	normalizeColumnLayout,
	parseColumnLayout,
	readColumnLayout,
	removeColumnLayout,
	writeColumnLayout,
	type ColumnLayoutColumn,
	type ColumnLayoutStorage,
} from './column-layout-persistence'

class MemoryStorage implements ColumnLayoutStorage {
	private values = new Map<string, string>()

	getItem(key: string) {
		return this.values.get(key) ?? null
	}

	setItem(key: string, value: string) {
		this.values.set(key, value)
	}

	removeItem(key: string) {
		this.values.delete(key)
	}
}

const columns: readonly ColumnLayoutColumn[] = [
	{ id: 'structure', minSize: 180, maxSize: 480 },
	{ id: 'health', minSize: 132, maxSize: 320 },
	{ id: 'status', minSize: 84, maxSize: 240 },
]

describe('column layout persistence', () => {
	afterEach(() => localStorage.clear())

	it('scopes keys by table, user, and agency without a shared fallback', () => {
		expect(getColumnLayoutStorageKey({ tableId: 'tree' })).toBeNull()
		expect(getColumnLayoutStorageKey({ tableId: 'tree', userId: 'user/1', organizationId: 'agency 1' })).toBe(
			'adomata:fleet-board:column-layout:v1:tree:user%2F1:agency%201',
		)
	})

	it('reconciles available columns and clamps only valid saved widths', () => {
		expect(
			normalizeColumnLayout(
				{
					order: ['health', 'unknown', 'health'],
					widths: { structure: 20, health: 999, status: Number.NaN, unknown: 150 },
				},
				columns,
			),
		).toEqual({
			order: ['health', 'structure', 'status'],
			widths: { structure: 180, health: 320 },
		})
	})

	it('falls back to defaults for malformed or unusable envelopes', () => {
		const defaults = defaultColumnLayout(columns)
		expect(parseColumnLayout('{"version":2,"order":["health"],"widths":{}}', columns)).toEqual(defaults)
		expect(parseColumnLayout('{"version":1,"order":["removed"],"widths":{}}', columns)).toEqual(defaults)
		expect(parseColumnLayout('{not-json', columns)).toEqual(defaults)
	})

	it('does not mark malformed or future-version data as safe to rewrite', () => {
		const storage = new MemoryStorage()
		storage.setItem('future', '{"version":99,"order":["health"],"widths":{}}')
		storage.setItem('malformed', '{not-json')

		expect(readColumnLayout(storage, 'future', columns).stored).toBe(false)
		expect(readColumnLayout(storage, 'malformed', columns).stored).toBe(false)
	})

	it('writes a versioned normalized envelope and removes it on reset', () => {
		const storage = new MemoryStorage()
		const key = 'test:column-layout'

		writeColumnLayout(storage, key, { order: ['status', 'structure', 'health'], widths: { status: 12 } }, columns)
		expect(JSON.parse(storage.getItem(key)!)).toEqual({
			version: 1,
			order: ['status', 'structure', 'health'],
			widths: { status: 84 },
		})
		expect(readColumnLayout(storage, key, columns).stored).toBe(true)

		removeColumnLayout(storage, key)
		expect(readColumnLayout(storage, key, columns)).toEqual({
			layout: defaultColumnLayout(columns),
			stored: false,
		})
	})

	it('treats storage failures as unavailable', () => {
		const failingStorage: ColumnLayoutStorage = {
			getItem: () => {
				throw new Error('blocked')
			},
			setItem: () => {
				throw new Error('blocked')
			},
			removeItem: () => {
				throw new Error('blocked')
			},
		}

		expect(readColumnLayout(failingStorage, 'key', columns)).toEqual({
			layout: defaultColumnLayout(columns),
			stored: false,
		})
		expect(() => writeColumnLayout(failingStorage, 'key', defaultColumnLayout(columns), columns)).not.toThrow()
		expect(() => removeColumnLayout(failingStorage, 'key')).not.toThrow()
	})
})
