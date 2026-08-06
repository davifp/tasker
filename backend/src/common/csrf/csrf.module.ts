import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';
import { CsrfMiddleware } from './csrf.middleware';

// Global so the guard token resolves for `APP_GUARD` in AppModule and the
// middleware can be attached to every route without per-feature wiring.
@Global()
@Module({
  providers: [CsrfGuard, CsrfMiddleware],
  exports: [CsrfGuard, CsrfMiddleware],
})
export class CsrfModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Runs on every incoming request: issues the CSRF cookie when absent,
    // rotates it when expired. Cheap enough (single random-bytes call at
    // most every 2 h per client) that no route exclusions are worth the
    // maintenance cost.
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}
