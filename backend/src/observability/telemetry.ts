import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { hostname } from 'node:os';

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  releaseId: string;
  environment: string;
  otlpEndpoint?: string;
  sampleRate: number;
  diagnosticLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
}

let sdk: NodeSDK | undefined;

export function readTelemetryConfig(
  env: NodeJS.ProcessEnv,
  serviceVersion: string,
): TelemetryConfig {
  const environment = env['NODE_ENV'] ?? 'development';
  const releaseId = env['RELEASE_ID'] || `dev-${hostname()}`;
  const rateRaw = env['OTEL_TRACES_SAMPLER_ARG'];
  const parsed = rateRaw !== undefined ? Number(rateRaw) : NaN;
  // Default to full sampling in dev/test (low volume, easier to debug) and 10%
  // in production. Operators can override via OTEL_TRACES_SAMPLER_ARG.
  const sampleRate = Number.isFinite(parsed)
    ? Math.min(1, Math.max(0, parsed))
    : environment === 'production'
      ? 0.1
      : 1;
  return {
    serviceName: env['OTEL_SERVICE_NAME'] ?? 'tasker-api',
    serviceVersion,
    releaseId,
    environment,
    otlpEndpoint: env['OTEL_EXPORTER_OTLP_ENDPOINT'],
    sampleRate,
    diagnosticLevel: (env['OTEL_LOG_LEVEL'] as TelemetryConfig['diagnosticLevel']) ?? 'error',
  };
}

// Starts the OpenTelemetry Node SDK. MUST be called before any @nestjs/* import
// or before any instrumented library is required — that's why callers should
// import `./telemetry.bootstrap` first, which invokes this side-effectfully.
export function startTelemetry(config: TelemetryConfig): NodeSDK {
  if (sdk) return sdk;

  if (config.diagnosticLevel && config.diagnosticLevel !== 'none') {
    diag.setLogger(
      new DiagConsoleLogger(),
      DiagLogLevel[config.diagnosticLevel.toUpperCase() as 'ERROR'],
    );
  }

  // KNOWN LIMITATION: head-based sampler. The techspec asks for "100% of
  // errored requests + configurable rate for successes"; that requires an OTel
  // Collector with `tail_sampling_processor` because span error status is only
  // known at span END. Set OTEL_TRACES_SAMPLER_ARG=1.0 in prod initially and
  // tighten once volume warrants a Collector deployment.
  const sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(config.sampleRate),
  });

  // Without explicit empty arrays, NodeSDK falls back to env-based OTLP
  // exporters defaulting to http://localhost:4318 (ECONNREFUSED in CI).
  const traceExporter = config.otlpEndpoint
    ? new OTLPTraceExporter({ url: `${config.otlpEndpoint.replace(/\/$/, '')}/v1/traces` })
    : undefined;
  const optOut = !config.otlpEndpoint;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      'deployment.environment': config.environment,
      'service.instance.id': hostname(),
      'tasker.release_id': config.releaseId,
    }),
    sampler,
    ...(traceExporter ? { traceExporter } : optOut ? { spanProcessors: [] } : {}),
    ...(optOut ? { metricReaders: [] } : {}),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs spans are noisy and rarely useful; host-metrics runs its own
        // collector loop we don't need on the Ampere box.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-host-metrics': { enabled: false },
        // pino is patched separately by our LogEnricher; auto-instrumentation
        // would double-inject traceId/spanId that already come from CLS.
        '@opentelemetry/instrumentation-pino': { enabled: false },
      }),
    ],
  });

  sdk.start();
  return sdk;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}
