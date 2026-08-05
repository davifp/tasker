import { describe, it, expect } from 'vitest';
import { readTelemetryConfig } from './telemetry';

describe('readTelemetryConfig', () => {
  const baseVersion = '1.2.3';

  it('picks a service.name default when OTEL_SERVICE_NAME is unset', () => {
    const config = readTelemetryConfig({ NODE_ENV: 'production' }, baseVersion);
    expect(config.serviceName).toBe('tasker-api');
    expect(config.serviceVersion).toBe(baseVersion);
  });

  it('respects OTEL_SERVICE_NAME override', () => {
    const config = readTelemetryConfig(
      { NODE_ENV: 'production', OTEL_SERVICE_NAME: 'tasker-worker' },
      baseVersion,
    );
    expect(config.serviceName).toBe('tasker-worker');
  });

  it('defaults sample rate to 1.0 outside production (full trace visibility during dev)', () => {
    expect(readTelemetryConfig({ NODE_ENV: 'development' }, baseVersion).sampleRate).toBe(1);
    expect(readTelemetryConfig({ NODE_ENV: 'test' }, baseVersion).sampleRate).toBe(1);
  });

  it('defaults sample rate to 0.1 in production (budgeted volume on the Ampere box)', () => {
    expect(readTelemetryConfig({ NODE_ENV: 'production' }, baseVersion).sampleRate).toBe(0.1);
  });

  it('honors OTEL_TRACES_SAMPLER_ARG when set, clamped to [0, 1]', () => {
    expect(
      readTelemetryConfig({ NODE_ENV: 'production', OTEL_TRACES_SAMPLER_ARG: '0.25' }, baseVersion)
        .sampleRate,
    ).toBe(0.25);
    expect(
      readTelemetryConfig({ NODE_ENV: 'production', OTEL_TRACES_SAMPLER_ARG: '2' }, baseVersion)
        .sampleRate,
    ).toBe(1);
    expect(
      readTelemetryConfig({ NODE_ENV: 'production', OTEL_TRACES_SAMPLER_ARG: '-1' }, baseVersion)
        .sampleRate,
    ).toBe(0);
  });

  it('falls back to the environment default when OTEL_TRACES_SAMPLER_ARG is not a number', () => {
    const config = readTelemetryConfig(
      { NODE_ENV: 'production', OTEL_TRACES_SAMPLER_ARG: 'off' },
      baseVersion,
    );
    expect(config.sampleRate).toBe(0.1);
  });

  it('uses RELEASE_ID when set, otherwise dev-<hostname>', () => {
    const withId = readTelemetryConfig({ RELEASE_ID: 'v1-abc' }, baseVersion);
    expect(withId.releaseId).toBe('v1-abc');
    const withoutId = readTelemetryConfig({}, baseVersion);
    expect(withoutId.releaseId).toMatch(/^dev-/);
  });

  it('leaves otlpEndpoint undefined when no exporter is configured (SDK ships a no-op exporter)', () => {
    expect(readTelemetryConfig({}, baseVersion).otlpEndpoint).toBeUndefined();
    expect(
      readTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://tempo:4318' }, baseVersion)
        .otlpEndpoint,
    ).toBe('http://tempo:4318');
  });
});
