import { SeverityNumber, logs } from '@opentelemetry/api-logs'

const otelLogger = logs.getLogger('adomata-api')

const severityNumbers = {
	info: SeverityNumber.INFO,
	warn: SeverityNumber.WARN,
	error: SeverityNumber.ERROR,
}

function errorReplacer(_key: string, value: unknown) {
	if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
	return value
}

function formatArg(arg: unknown): string {
	if (typeof arg === 'string') return arg
	if (arg instanceof Error) return arg.stack ?? arg.message
	return JSON.stringify(arg, errorReplacer)
}

function emit(method: 'info' | 'warn' | 'error', level: string, args: unknown[]) {
	console[method](`${new Date().toISOString()} ${level.padEnd(5)}`, ...args)
	// No-op outside production: logs.getLogger() returns a no-op Logger until
	// core/telemetry.ts calls NodeSDK#start(), which only happens in prod.
	otelLogger.emit({
		severityNumber: severityNumbers[method],
		severityText: level,
		body: args.map(formatArg).join(' '),
	})
}

export const logger = {
	info: (...args: unknown[]) => emit('info', 'INFO', args),
	warn: (...args: unknown[]) => emit('warn', 'WARN', args),
	error: (...args: unknown[]) => emit('error', 'ERROR', args),
}
