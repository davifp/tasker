import { Module } from '@nestjs/common';
import { RedisModule } from '../../common/redis/redis.module';
import { ProjectsModule } from '../../projects/projects.module';
import { TasksModule } from '../../tasks/tasks.module';
import { GithubIntegrationController } from './github/github.controller';
import { GithubIntegrationService } from './github/github-integration.service';
import { GithubLinkController } from './github/github-link.controller';
import { GithubLinkService } from './github/github-link.service';
import { GithubWebhookController } from './github/github-webhook.controller';
import { GoogleCalendarController } from './google-calendar/google-calendar.controller';
import { GoogleCalendarService } from './google-calendar/google-calendar.service';
import { IntegrationOAuthStateService } from './integration-oauth-state.service';
import { integrationTokenVaultProvider } from './integration-token-vault.provider';
import { IntegrationMetricsCollector } from './integration.metrics';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [RedisModule, ProjectsModule, TasksModule],
  controllers: [
    IntegrationsController,
    GithubIntegrationController,
    GithubLinkController,
    GithubWebhookController,
    GoogleCalendarController,
  ],
  providers: [
    IntegrationsService,
    IntegrationOAuthStateService,
    integrationTokenVaultProvider,
    GithubIntegrationService,
    GithubLinkService,
    GoogleCalendarService,
    IntegrationMetricsCollector,
  ],
  exports: [
    IntegrationsService,
    GithubLinkService,
    GithubIntegrationService,
    GoogleCalendarService,
    IntegrationMetricsCollector,
  ],
})
export class IntegrationsModule {}
