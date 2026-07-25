import { describe, it, expect } from 'vitest';
import {
  METRIC_DEFINITIONS,
  METRICS_DEFAULT_WINDOW,
  METRICS_WINDOW_PRESETS,
  METRICS_REFRESH_CRON_DEFAULT,
  METRICS_REFRESH_LOCK_TTL_SEC_DEFAULT,
  MetricsConfig,
  BUSINESS_HOURS,
} from './metrics';

describe('MetricsConfig', () => {
  it('locks lead time and cycle time definitions', () => {
    expect(METRIC_DEFINITIONS.leadTime).toContain('creation');
    expect(METRIC_DEFINITIONS.cycleTime).toContain('In Progress');
    expect(Object.isFrozen(METRIC_DEFINITIONS)).toBe(true);
  });

  it('offers default_window that appears in the presets', () => {
    expect(METRICS_WINDOW_PRESETS).toContain(METRICS_DEFAULT_WINDOW);
  });

  it('exposes a cron cadence and lock TTL for the refresh job', () => {
    expect(METRICS_REFRESH_CRON_DEFAULT).toMatch(/^\*\/15/);
    expect(METRICS_REFRESH_LOCK_TTL_SEC_DEFAULT).toBeGreaterThanOrEqual(60);
  });

  it('bundles a frozen snapshot for downstream consumers', () => {
    expect(Object.isFrozen(MetricsConfig)).toBe(true);
    expect(MetricsConfig.windowPresets).toBe(METRICS_WINDOW_PRESETS);
  });

  it('business hours cover a work week ending Friday, starting Monday', () => {
    expect(BUSINESS_HOURS.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(BUSINESS_HOURS.startHour).toBeLessThan(BUSINESS_HOURS.endHour);
  });
});
