import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { TraceContext } from '../trace/trace-context';

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers['x-trace-id'];
    const traceId = typeof inbound === 'string' ? inbound : randomUUID();
    res.setHeader('x-trace-id', traceId);
    TraceContext.run(traceId, next);
  }
}
