import { Module } from '@nestjs/common';
import { RedisModule } from '../../common/redis/redis.module';
import { ProjectsModule } from '../../projects/projects.module';
import { TasksModule } from '../../tasks/tasks.module';
import { GithubIntegrationController } from './github/github.controller';
import { GithubIntegrationService } from './github/github-integration.service';
import { GithubLinkController } from './github/github-link.controller';
import { GithubLinkService } from './github/github-link.service';
import { GithubWebhookController } from './github/github-webhook.controller';
import { IntegrationOAuthStateService } from './integration-oauth-state.service';
import { integrationTokenVaultProvider } from './integration-token-vault.provider';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [RedisModule, ProjectsModule, TasksModule],
  controllers: [
    IntegrationsController,
    GithubIntegrationController,
    GithubLinkController,
    GithubWebhookController,
  ],
  providers: [
    IntegrationsService,
    IntegrationOAuthStateService,
    integrationTokenVaultProvider,
    GithubIntegrationService,
    GithubLinkService,
  ],
  exports: [IntegrationsService, GithubLinkService, GithubIntegrationService],
})
export class IntegrationsModule {}
