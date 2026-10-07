import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { resolveRequestId } from './request-id.js';

/** Logs JSON estruturados com requestId e redação de dados sensíveis (LGPD / segredos). */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          base: { service: 'f4d-api', version: env.APP_VERSION, env: env.NODE_ENV },
          genReqId: resolveRequestId,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-csrf-token"]',
              'res.headers["set-cookie"]',
              '*.password',
              '*.token',
              '*.refreshToken',
              '*.cpf',
            ],
            censor: '[redacted]',
          },
          customLogLevel: (req, res, error) => {
            // Probes de health rodam a cada poucos segundos; a indisponibilidade já é
            // sinalizada pelo próprio probe e pelos logs das dependências.
            if (req.url?.startsWith('/v1/health')) return 'silent';
            if (error || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
          ...(env.NODE_ENV === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
        },
      }),
    }),
  ],
})
export class LoggerModule {}
