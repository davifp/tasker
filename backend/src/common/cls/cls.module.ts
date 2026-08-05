import { Global, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { ClsModule as NestClsModule, ClsService } from 'nestjs-cls';
import { CLS_TRACE_ID } from './cls-keys';
import { extractInboundTraceId } from './trace-header';

@Global()
@Module({
  imports: [
    NestClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => extractInboundTraceId(req.headers) ?? randomUUID(),
        setup: (cls: ClsService, _req: Request, res: Response) => {
          const traceId = cls.getId();
          cls.set(CLS_TRACE_ID, traceId);
          res.setHeader('x-trace-id', traceId);
        },
      },
    }),
  ],
  exports: [NestClsModule],
})
export class ClsContextModule {}
