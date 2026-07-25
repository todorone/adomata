import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fakes just enough of the OTel API surface to assert the wrapper drives spans
// correctly, without needing a real TracerProvider registered.
const span = { end: vi.fn(), recordException: vi.fn(), setStatus: vi.fn() }
const startSpan = vi.fn(() => span)
vi.mock('@opentelemetry/api', () => ({
	trace: { getTracer: () => ({ startSpan }) },
	SpanStatusCode: { ERROR: 2 },
}))

beforeEach(() => {
	vi.clearAllMocks()
})

const { traceSql } = await import('../core/dbTracing')

// Mimics Bun's SQL.unsafe: returns a thenable "Query" builder with a chainable
// `.values()`, matching how drizzle-orm/bun-sql actually calls it
// (`client.unsafe(query, params).values()`), so the wrapper must not replace
// the returned object or that chain breaks.
function fakeQuery(settle: () => Promise<unknown>) {
	const promise = settle()
	return Object.assign(promise, { values: () => promise })
}

describe('traceSql', () => {
	it('preserves the original Query object so chained calls like .values() still work', () => {
		const query = fakeQuery(() => Promise.resolve([{ id: 1 }]))
		const client = { unsafe: vi.fn(() => query) }

		const result = traceSql(client as unknown as Parameters<typeof traceSql>[0]).unsafe('select 1', [])

		expect(result).toBe(query.values())
	})

	it('ends the span with the query text on success', async () => {
		const client = { unsafe: vi.fn(() => fakeQuery(() => Promise.resolve([{ id: 1 }]))) }

		await traceSql(client as unknown as Parameters<typeof traceSql>[0]).unsafe('select 1', [])
		await Promise.resolve() // let the .then() tap fire

		expect(startSpan).toHaveBeenCalledWith('db.query', {
			attributes: { 'db.system': 'postgresql', 'db.statement': 'select 1' },
		})
		expect(span.end).toHaveBeenCalledTimes(1)
		expect(span.recordException).not.toHaveBeenCalled()
	})

	it('records the exception and still rejects the caller on query failure', async () => {
		const boom = new Error('connection refused')
		const client = { unsafe: vi.fn(() => fakeQuery(() => Promise.reject(boom))) }

		await expect(
			traceSql(client as unknown as Parameters<typeof traceSql>[0]).unsafe('select 1', []),
		).rejects.toThrow(boom)
		await Promise.resolve()

		expect(span.recordException).toHaveBeenCalledWith(boom)
		expect(span.setStatus).toHaveBeenCalledWith({ code: 2 })
		expect(span.end).toHaveBeenCalledTimes(1)
	})
})
