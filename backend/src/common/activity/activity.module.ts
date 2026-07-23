import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityBus } from './activity.bus';
import { ActivityController } from './activity.controller';
import { ActivityInterceptor } from './activity.interceptor';
import { ActivityService } from './activity.service';

/**
 * Global so any feature module can `@Inject(ActivityService)` without pulling
 * the module in explicitly. The interceptor's lifecycle hooks (subscribe on
 * init / unsubscribe on destroy) run when Nest instantiates it as a provider
 * — it does NOT need to be registered as an APP_INTERCEPTOR.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ActivityController],
  providers: [ActivityBus, ActivityService, ActivityInterceptor],
  exports: [ActivityService, ActivityBus],
})
export class ActivityModule {}
