import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ENV } from './shared/config/config.module.js';
import type { Env } from './shared/config/env.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './shared/infra/logger/request-id.js';

export const createFastifyAdapter = (): FastifyAdapter =>
  new FastifyAdapter({
    // Atrás do load balancer do PaaS: confia no X-Forwarded-For para IP real (rate limit, auditoria).
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    // O id é resolvido (e validado) por nós, não lido cru do header.
    requestIdHeader: false,
    genReqId: resolveRequestId,
  });

/**
 * Segurança da borda (docs/architecture.md §7). Aplicada tanto pelo `main.ts` quanto pelos
 * testes e2e, que assim exercitam exatamente a mesma configuração.
 */
export const configureHttpApp = async (
  app: NestFastifyApplication,
): Promise<NestFastifyApplication> => {
  app.useLogger(app.get(Logger));
  const env = app.get<Env>(ENV);

  await app.register(helmet, {
    // API só responde JSON: CSP restritiva, sem framing.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
  });

  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'x-request-id', 'authorization'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (req, reply, done) => {
      void reply.header(REQUEST_ID_HEADER, req.id);
      done();
    });

  app.enableShutdownHooks();
  return app;
};

export const createHttpApp = async (): Promise<NestFastifyApplication> => {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createFastifyAdapter(), {
    bufferLogs: true,
  });
  return configureHttpApp(app);
};
