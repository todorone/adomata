import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { SQL } from 'bun'

const tracer = trace.getTracer('adomata.db')

// Wraps `sql.unsafe`, the single choke point drizzle-orm/bun-sql routes every
// query through (see BunSQLSession in drizzle-orm), so every query gets a
// child span without touching call sites elsewhere. The returned Query is
// Bun's own builder object (chainable `.values()`/`.raw()`) — we must return
// it unmodified and only *observe* completion via `.then()`, never replace it,
// or callers relying on that chain (e.g. drizzle) would break.
export function traceSql<T extends Pick<SQL, 'unsafe'>>(client: T): T {
	const originalUnsafe = client.unsafe.bind(client)

	client.unsafe = ((query: string, values?: unknown[]) => {
		const span = tracer.startSpan('db.query', { attributes: { 'db.system': 'postgresql', 'db.statement': query } })
		const result = originalUnsafe(query, values)
		result.then(
			() => span.end(),
			(err: unknown) => {
				span.recordException(err instanceof Error ? err : new Error(String(err)))
				span.setStatus({ code: SpanStatusCode.ERROR })
				span.end()
			},
		)
		return result
	}) as T['unsafe']

	return client
}
