import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { MetricsRegistryService } from './metrics-registry.service';

/**
 * Prometheus scrape endpoint. Public so a scraper doesn't need auth — the
 * outer network posture (VPC / ingress ACL) restricts who can reach `/metrics`,
 * matching how the process-level `/health` endpoint is gated today.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly registry: MetricsRegistryService) {}

  @Get()
  @Public()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): Promise<string> {
    return this.registry.render();
  }
}
