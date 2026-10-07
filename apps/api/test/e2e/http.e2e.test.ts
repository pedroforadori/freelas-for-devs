import { getQueueToken } from '@nestjs/bullmq';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApp, createFastifyAdapter } from '../../src/http-app.js';
import { PG_POOL } from '../../src/shared/infra/database/database.module.js';
import { REDIS } from '../../src/shared/infra/queue/queue.module.js';
import { QueueName } from '../../src/shared/infra/queue/queue-names.js';

/**
 * Sobe a aplicação HTTP completa (filtros, interceptors, helmet, CORS, rate limit) com
 * Postgres e Redis substituídos por dublês — roda sem Docker. Integração real: test/integration.
 */
const dependencies = { postgres: true, redis: true };

const fakePool = {
  query: () =>
    dependencies.postgres
      ? Promise.resolve({ rows: [{ ok: 1 }] })
      : Promise.reject(new Error('ECONNREFUSED')),
  end: () => Promise.resolve(),
};
const fakeRedis = {
  status: 'ready',
  ping: () =>
    dependencies.redis ? Promise.resolve('PONG') : Promise.reject(new Error('ECONNREFUSED')),
  quit: () => Promise.resolve('OK'),
};
const fakeQueue = {
  name: 'domain-events',
  add: () => Promise.resolve(),
  on: () => undefined,
  close: () => Promise.resolve(),
};

const ALLOWED_ORIGIN = 'http://localhost:3000';
let app: NestFastifyApplication;

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_VERSION: '1.2.3-test',
    DATABASE_URL: 'postgres://f4d:f4d@localhost:5432/f4d',
    REDIS_URL: 'redis://localhost:6379',
    CORS_ORIGINS: ALLOWED_ORIGIN,
    RATE_LIMIT_PER_MINUTE: '1000',
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL)
    .useValue(fakePool)
    .overrideProvider(REDIS)
    .useValue(fakeRedis)
    .overrideProvider(getQueueToken(QueueName.DomainEvents))
    .useValue(fakeQueue)
    .compile();

  app = await configureHttpApp(
    moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter()),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
});

describe('HTTP edge', () => {
  it('serves liveness from the contract', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', version: '1.2.3-test' });
  });

  it('reports readiness and degrades with 503 when a dependency is down', async () => {
    const ready = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready', checks: { postgres: 'up', redis: 'up' } });

    dependencies.redis = false;
    const degraded = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    dependencies.redis = true;
    expect(degraded.statusCode).toBe(503);
    expect(degraded.json()).toEqual({
      status: 'degraded',
      checks: { postgres: 'up', redis: 'down' },
    });
  });

  it('answers unknown routes with RFC 9457 problem details and a request id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/nope',
      headers: { 'x-request-id': 'req-12345678' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404, code: 'NOT_FOUND', requestId: 'req-12345678' });
  });

  it('echoes a safe request id and replaces an unsafe one', async () => {
    const echoed = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'abc-12345678' },
    });
    expect(echoed.headers['x-request-id']).toBe('abc-12345678');

    const unsafe = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'bad id\ninjected' },
    });
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS with credentials only for configured origins', async () => {
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/v1/health',
      headers: { origin: ALLOWED_ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/v1/health',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves the OpenAPI document outside production', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ openapi: '3.1.0', info: { title: 'Freelas 4 Devs API' } });
  });
});
