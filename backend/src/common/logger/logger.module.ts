import { hostname } from 'node:os';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Env } from '@tasker/config';
import { createLogMixin, LOG_REDACT_PATHS } from './log-enricher';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isDev = config.get('NODE_ENV') !== 'production';
        const releaseId = config.get('RELEASE_ID') || `dev-${hostname()}`;
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL'),
            mixin: createLogMixin(releaseId),
            redact: {
              paths: LOG_REDACT_PATHS,
              censor: '[REDACTED]',
              remove: false,
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
