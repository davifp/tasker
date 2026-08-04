import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { ApiKeyHasher } from './api-key-hasher';
import { ApiKeyStrategy } from './api-key.strategy';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ScopesGuard } from './scopes.guard';

@Module({
  imports: [PassportModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyHasher, ApiKeyStrategy, ApiKeyAuthGuard, ScopesGuard],
  exports: [ApiKeysService, ApiKeyAuthGuard, ScopesGuard],
})
export class ApiKeysModule {}
