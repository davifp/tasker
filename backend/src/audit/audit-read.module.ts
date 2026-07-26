import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditController } from './audit.controller';
import { AuditReadService } from './audit-read.service';
import { AuditCsvExporter } from './audit-csv.exporter';

@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditReadService, AuditCsvExporter],
  exports: [AuditReadService, AuditCsvExporter],
})
export class AuditReadModule {}
