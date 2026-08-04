import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { API_KEY_STRATEGY } from './api-key.strategy';

/**
 * Route-level guard that requires an API-key principal on `req.user`. Apply
 * with `@UseGuards(ApiKeyAuthGuard)` on public REST endpoints intended for
 * programmatic access. The global JwtAuthGuard is bypassed via `@Public()`
 * on those routes so the API-key strategy has room to run.
 */
@Injectable()
export class ApiKeyAuthGuard extends AuthGuard(API_KEY_STRATEGY) {}
