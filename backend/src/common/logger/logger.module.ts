import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { TraceContext } from '../trace/trace-context';
import type { Env } from '@tasker/config';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isDev = config.get('NODE_ENV') !== 'production';
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL'),
            mixin: () => {
              const traceId = TraceContext.get();
              return traceId ? { traceId } : {};
            },
            transport: isDev ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
