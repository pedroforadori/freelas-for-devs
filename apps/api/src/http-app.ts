import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ENV } from './shared/config/config.module.js';
import type { Env } from './shared/config/env.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './shared/infra/logger/request-id.js';
import { AppIoAdapter } from './shared/infra/realtime/socket-io.adapter.js';

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
  options: { realtimeRedis?: boolean } = {},
): Promise<NestFastifyApplication> => {
  app.useLogger(app.get(Logger));
  const env = app.get<Env>(ENV);

  await app.register(cookie);
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

  // Chat em tempo real (Socket.IO) no mesmo servidor HTTP. Com várias réplicas, o adapter Redis
  // entrega as mensagens aos sockets conectados em qualquer uma delas.
  const io = new AppIoAdapter(app, env.CORS_ORIGINS);
  if (options.realtimeRedis) io.connectToRedis(env.REDIS_URL);
  app.useWebSocketAdapter(io);

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
    // Webhooks de pagamento verificam a assinatura sobre o corpo cru.
    rawBody: true,
  });
  return configureHttpApp(app, { realtimeRedis: true });
};
