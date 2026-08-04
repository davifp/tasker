import { Injectable } from '@nestjs/common';

// Small in-memory counters exposed via the Prometheus scrape endpoint. The
// Grafana panel wired in Task 9.0 consumes these labels directly.
@Injectable()
export class RateLimitMetricsCollector {
  private readonly requestsTotal = new Map<string, number>();
  private readonly rateLimitHitsTotal = new Map<string, number>();

  incrementRequest(keyPrefix: string, status: number): void {
    const label = `${keyPrefix}|${status}`;
    this.requestsTotal.set(label, (this.requestsTotal.get(label) ?? 0) + 1);
  }

  incrementRateLimitHit(keyPrefix: string): void {
    this.rateLimitHitsTotal.set(keyPrefix, (this.rateLimitHitsTotal.get(keyPrefix) ?? 0) + 1);
  }

  render(): string {
    const lines: string[] = [];

    lines.push('# HELP platform_api_requests_total Public-API requests by key prefix and status.');
    lines.push('# TYPE platform_api_requests_total counter');
    for (const [label, value] of this.requestsTotal) {
      const [keyPrefix, status] = label.split('|');
      lines.push(
        `platform_api_requests_total{key_prefix="${keyPrefix}",status="${status}"} ${value}`,
      );
    }

    lines.push('# HELP platform_api_ratelimit_hits_total Public-API 429 responses by key prefix.');
    lines.push('# TYPE platform_api_ratelimit_hits_total counter');
    for (const [keyPrefix, value] of this.rateLimitHitsTotal) {
      lines.push(`platform_api_ratelimit_hits_total{key_prefix="${keyPrefix}"} ${value}`);
    }

    return lines.join('\n') + '\n';
  }

  snapshot() {
    return {
      requestsTotal: Object.fromEntries(this.requestsTotal),
      rateLimitHitsTotal: Object.fromEntries(this.rateLimitHitsTotal),
    };
  }
}
