import { Global, Module } from '@nestjs/common';
import { ContextModule } from '../common/context/context.module';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  imports: [ContextModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
