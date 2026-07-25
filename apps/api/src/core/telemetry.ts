import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'

// Production-only: traces + logs ship to OpenObserve via OTLP/HTTP. Endpoint,
// headers, and service name come from the standard OTEL_EXPORTER_OTLP_ENDPOINT /
// OTEL_EXPORTER_OTLP_HEADERS / OTEL_SERVICE_NAME env vars, read automatically
// by the exporters and the SDK's resource detection. Local dev and Vitest
// never call sdk.start(), so the global tracer/logger stay the OTel no-op
// implementations and every span/log call elsewhere in the app is a no-op.
if (process.env.NODE_ENV === 'production') {
	const sdk = new NodeSDK({
		traceExporter: new OTLPTraceExporter(),
		logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
	})
	sdk.start()
}
