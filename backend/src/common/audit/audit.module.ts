import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditService } from './audit.service';
import { AuditSubscriber } from './audit.subscriber';
import { AuditMutationInterceptor } from './audit-mutation.interceptor';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditService, AuditSubscriber, AuditMutationInterceptor],
  exports: [AuditService, AuditMutationInterceptor],
})
export class AuditModule {}
