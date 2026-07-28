import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PlanningMetricsCollector } from './planning.metrics';
import { SearchAuditMetricsCollector } from './search-audit.metrics';
import { RealtimeMetricsCollector } from './realtime.metrics';
import { NotificationsMetricsCollector } from './notifications.metrics';
import { AiMetricsCollector } from '../ai/metrics/ai.metrics';

/**
 * Prometheus scrape endpoint. Public so a scraper doesn't need auth —
 * the outer network posture (VPC / ingress ACL) restricts who can reach
 * `/metrics`, matching how the process-level `/health` endpoint is
 * gated today.
 */
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly planning: PlanningMetricsCollector,
    private readonly searchAudit: SearchAuditMetricsCollector,
    private readonly realtime: RealtimeMetricsCollector,
    private readonly notifications: NotificationsMetricsCollector,
    private readonly ai: AiMetricsCollector,
  ) {}

  @Get()
  @Public()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): string {
    return (
      this.planning.render() +
      this.searchAudit.render() +
      this.realtime.render() +
      this.notifications.render() +
      this.ai.render()
    );
  }
}
