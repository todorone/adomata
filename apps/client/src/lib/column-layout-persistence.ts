import { useEffect, useRef, useState } from 'react'

export const columnLayoutVersion = 1

export type ColumnLayoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type ColumnLayoutColumn<ColumnId extends string = string> = {
	id: ColumnId
	minSize?: number
	maxSize?: number
}

export type ColumnLayout<ColumnId extends string = string> = {
	order: ColumnId[]
	widths: Record<string, number>
}

type StoredColumnLayout = {
	version: typeof columnLayoutVersion
	order: string[]
	widths: Record<string, unknown>
}

export function getBrowserStorage(): ColumnLayoutStorage | null {
	if (typeof window === 'undefined') return null
	try {
		return window.localStorage
	} catch {
		return null
	}
}

export function getColumnLayoutStorageKey({
	tableId,
	userId,
	organizationId,
	namespace = 'adomata:fleet-board',
}: {
	tableId: string
	userId?: string | null
	organizationId?: string | null
	namespace?: string
}) {
	if (!userId || !organizationId) return null
	return `${namespace}:column-layout:v${columnLayoutVersion}:${encodeURIComponent(tableId)}:${encodeURIComponent(userId)}:${encodeURIComponent(organizationId)}`
}

export function reconcileColumnOrder<ColumnId extends string>(
	current: readonly ColumnId[],
	available: readonly ColumnId[],
) {
	const availableSet = new Set(available)
	return [
		...current.filter((id, index) => availableSet.has(id) && current.indexOf(id) === index),
		...available.filter(id => !current.includes(id)),
	]
}

export function defaultColumnLayout<ColumnId extends string>(
	columns: readonly ColumnLayoutColumn<ColumnId>[],
): ColumnLayout<ColumnId> {
	return { order: columns.map(column => column.id), widths: {} }
}

export function normalizeColumnLayout<ColumnId extends string>(
	layout: { order: readonly ColumnId[]; widths: Readonly<Record<string, unknown>> },
	columns: readonly ColumnLayoutColumn<ColumnId>[],
): ColumnLayout<ColumnId> {
	const defaults = defaultColumnLayout(columns)
	const available = columns.map(column => column.id)
	const availableSet = new Set(available)
	const usableOrder = layout.order.filter(id => availableSet.has(id))
	if (usableOrder.length === 0 && available.length > 0) return defaults

	const widths = Object.fromEntries(
		columns.flatMap(column => {
			const width = layout.widths[column.id]
			if (typeof width !== 'number' || !Number.isFinite(width)) return []

			const min = Number.isFinite(column.minSize) ? column.minSize! : Number.NEGATIVE_INFINITY
			const max = Number.isFinite(column.maxSize) ? column.maxSize! : Number.POSITIVE_INFINITY
			return [[column.id, Math.min(max, Math.max(min, width))] as const]
		}),
	)

	return {
		order: reconcileColumnOrder(usableOrder, available),
		widths,
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStoredColumnLayout(value: string | null): StoredColumnLayout | null {
	if (value === null) return null
	try {
		const parsed: unknown = JSON.parse(value)
		if (!isRecord(parsed)) return null
		if (parsed.version !== columnLayoutVersion) return null
		if (!Array.isArray(parsed.order) || !parsed.order.every(id => typeof id === 'string' && id.length > 0))
			return null
		if (!isRecord(parsed.widths)) return null
		return {
			version: columnLayoutVersion,
			order: parsed.order,
			widths: parsed.widths,
		}
	} catch {
		return null
	}
}

export function parseColumnLayout<ColumnId extends string>(
	value: string | null,
	columns: readonly ColumnLayoutColumn<ColumnId>[],
): ColumnLayout<ColumnId> {
	const defaults = defaultColumnLayout(columns)
	const parsed = parseStoredColumnLayout(value)
	if (!parsed) return defaults
	return normalizeColumnLayout({ order: parsed.order as ColumnId[], widths: parsed.widths }, columns)
}

export function readColumnLayout<ColumnId extends string>(
	storage: ColumnLayoutStorage | null,
	key: string | null,
	columns: readonly ColumnLayoutColumn<ColumnId>[],
) {
	const defaults = defaultColumnLayout(columns)
	if (!storage || !key) return { layout: defaults, stored: false }
	try {
		const value = storage.getItem(key)
		const parsed = parseStoredColumnLayout(value)
		return {
			layout: parsed
				? normalizeColumnLayout({ order: parsed.order as ColumnId[], widths: parsed.widths }, columns)
				: defaults,
			stored: parsed !== null,
		}
	} catch {
		return { layout: defaults, stored: false }
	}
}

export function writeColumnLayout<ColumnId extends string>(
	storage: ColumnLayoutStorage | null,
	key: string | null,
	layout: Pick<ColumnLayout<ColumnId>, 'order' | 'widths'>,
	columns: readonly ColumnLayoutColumn<ColumnId>[],
) {
	if (!storage || !key) return
	const normalized = normalizeColumnLayout(layout, columns)
	const value = JSON.stringify({
		version: columnLayoutVersion,
		order: normalized.order,
		widths: normalized.widths,
	})
	try {
		storage.setItem(key, value)
	} catch {
		// A storage policy or quota failure must not interrupt board interactions.
	}
}

export function removeColumnLayout(storage: ColumnLayoutStorage | null, key: string | null) {
	if (!storage || !key) return
	try {
		storage.removeItem(key)
	} catch {
		// A storage policy failure must not interrupt resetting the in-memory layout.
	}
}

type ColumnLayoutUpdater<ColumnId extends string> = ColumnId[] | ((current: ColumnId[]) => ColumnId[])

type ValueUpdater<Value> = Value | ((current: Value) => Value)

export function useColumnLayoutPersistence<ColumnId extends string>({
	columns,
	storageKey,
	storage,
}: {
	columns: readonly ColumnLayoutColumn<ColumnId>[]
	storageKey: string | null
	storage?: ColumnLayoutStorage | null
}) {
	const browserStorage = storage === undefined ? getBrowserStorage() : storage
	const columnsKey = JSON.stringify(columns)
	const columnsRef = useRef(columns)
	const storageRef = useRef(browserStorage)
	const storageKeyRef = useRef(storageKey)
	useEffect(() => {
		columnsRef.current = columns
		storageRef.current = browserStorage
		storageKeyRef.current = storageKey
	}, [browserStorage, columns, columnsKey, storageKey])

	const [initial] = useState<ColumnLayout<ColumnId>>(() =>
		storageKey ? readColumnLayout(browserStorage, storageKey, columns).layout : defaultColumnLayout(columns),
	)
	const [columnOrder, setColumnOrder] = useState<ColumnId[]>(initial.order)
	const [columnSizing, setColumnSizing] = useState<Record<string, number>>(initial.widths)
	const columnOrderRef = useRef(columnOrder)
	const columnSizingRef = useRef(columnSizing)
	const hydratedStorageKeyRef = useRef(storageKey)
	const hydratedColumnsKeyRef = useRef(columnsKey)
	const [applyLayout] = useState<(layout: ColumnLayout<ColumnId>) => void>(() => (layout: ColumnLayout<ColumnId>) => {
		columnOrderRef.current = layout.order
		columnSizingRef.current = layout.widths
		setColumnOrder(layout.order)
		setColumnSizing(layout.widths)
	})
	const [persistColumnLayout] = useState<() => void>(() => () => {
		writeColumnLayout(
			storageRef.current,
			storageKeyRef.current,
			{ order: columnOrderRef.current, widths: columnSizingRef.current },
			columnsRef.current,
		)
	})

	function persist(layout: Pick<ColumnLayout<ColumnId>, 'order' | 'widths'>) {
		writeColumnLayout(storageRef.current, storageKey, layout, columnsRef.current)
	}

	function updateColumnOrder(updater: ColumnLayoutUpdater<ColumnId>) {
		const next = typeof updater === 'function' ? updater(columnOrderRef.current) : updater
		const normalized = normalizeColumnLayout({ order: next, widths: columnSizingRef.current }, columnsRef.current)
		applyLayout(normalized)
		persist(normalized)
	}

	function updateColumnSizing(updater: ValueUpdater<Record<string, number>>) {
		const next = typeof updater === 'function' ? updater(columnSizingRef.current) : updater
		const normalized = normalizeColumnLayout({ order: columnOrderRef.current, widths: next }, columnsRef.current)
		applyLayout(normalized)
	}

	function resetColumnLayout() {
		applyLayout(defaultColumnLayout(columnsRef.current))
		removeColumnLayout(storageRef.current, storageKey)
	}

	useEffect(() => {
		const scopeChanged = hydratedStorageKeyRef.current !== storageKey
		const columnsChanged = hydratedColumnsKeyRef.current !== columnsKey
		if (!scopeChanged && !columnsChanged) return

		const stored = readColumnLayout(storageRef.current, storageKey, columnsRef.current)
		const next = scopeChanged
			? stored.layout
			: normalizeColumnLayout({ order: columnOrderRef.current, widths: columnSizingRef.current }, columnsRef.current)
		applyLayout(next)
		hydratedStorageKeyRef.current = storageKey
		hydratedColumnsKeyRef.current = columnsKey
		if (storageKey && stored.stored) {
			writeColumnLayout(storageRef.current, storageKey, next, columnsRef.current)
		}
	}, [applyLayout, columnsKey, storageKey])

	useEffect(() => {
		if (!storageKey || typeof window === 'undefined') return
		const currentStorage = storageRef.current
		const onStorage = (event: StorageEvent) => {
			if (event.key !== storageKey) return
			if (event.storageArea && currentStorage && event.storageArea !== currentStorage) return
			applyLayout(parseColumnLayout(event.newValue, columnsRef.current))
		}
		window.addEventListener('storage', onStorage)
		return () => window.removeEventListener('storage', onStorage)
	}, [applyLayout, columnsKey, storageKey])

	return {
		columnOrder,
		columnSizing,
		onColumnOrderChange: updateColumnOrder,
		onColumnSizingChange: updateColumnSizing,
		persistColumnLayout,
		resetColumnLayout,
	}
}
