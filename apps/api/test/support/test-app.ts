import { getQueueToken } from '@nestjs/bullmq';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import type { LightMyRequestResponse as InjectResponse } from 'fastify';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApp, createFastifyAdapter } from '../../src/http-app.js';
import type { EmailMessage } from '../../src/shared/application/mailer.js';
import { CLOCK } from '../../src/shared/infra/core.module.js';
import { DATABASE, PG_POOL } from '../../src/shared/infra/database/database.module.js';
import { FakeClock } from '../../src/shared/kernel/clock.js';
import { REDIS } from '../../src/shared/infra/queue/queue.module.js';
import { QueueName } from '../../src/shared/infra/queue/queue-names.js';
import { createTestDatabase, type TestDatabase } from './pglite.js';

export const WEB_ORIGIN = 'http://localhost:3000';

/** Fila falsa que guarda os jobs enfileirados (ex.: e-mails) para inspeção nos testes. */
export class CapturingQueue<T = unknown> {
  readonly jobs: { name: string; data: T }[] = [];
  constructor(readonly name: string) {}
  add(name: string, data: T) {
    this.jobs.push({ name, data });
    return Promise.resolve({ id: String(this.jobs.length) });
  }
  on() {
    return this;
  }
  close() {
    return Promise.resolve();
  }
}

export interface TestApp {
  app: NestFastifyApplication;
  database: TestDatabase;
  redis: Redis;
  mail: CapturingQueue<EmailMessage>;
  /** Relógio dos casos de uso (prazos, rotação). Começa no horário real. */
  clock: FakeClock;
  dependencies: { postgres: boolean; redis: boolean };
  close(): Promise<void>;
}

/**
 * Aplicação HTTP real (guards, filtros, cookies, rate limit) com dependências em processo:
 * Postgres = PGlite, Redis = ioredis-mock, filas BullMQ = captura em memória. Roda sem Docker.
 */
export const createTestApp = async (env: Record<string, string> = {}): Promise<TestApp> => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_VERSION: '1.2.3-test',
    DATABASE_URL: 'postgres://f4d:f4d@localhost:5432/f4d',
    REDIS_URL: 'redis://localhost:6379',
    CORS_ORIGINS: WEB_ORIGIN,
    RATE_LIMIT_PER_MINUTE: '1000',
    COOKIE_SECURE: 'true',
    WEB_APP_URL: 'https://app.test',
    ...env,
  });

  const database = await createTestDatabase();
  const redis = new RedisMock();
  const mail = new CapturingQueue<EmailMessage>(QueueName.Mail);
  const dependencies = { postgres: true, redis: true };
  const clock = new FakeClock(new Date());

  const fakePool = {
    query: () =>
      dependencies.postgres
        ? Promise.resolve({ rows: [{ ok: 1 }] })
        : Promise.reject(new Error('ECONNREFUSED')),
    end: () => Promise.resolve(),
  };
  const healthAwareRedis = new Proxy(redis, {
    get(target, prop, receiver) {
      if (prop === 'ping' && !dependencies.redis)
        return () => Promise.reject(new Error('ECONNREFUSED'));
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(PG_POOL)
    .useValue(fakePool)
    .overrideProvider(DATABASE)
    .useValue(database.db)
    .overrideProvider(REDIS)
    .useValue(healthAwareRedis)
    .overrideProvider(getQueueToken(QueueName.DomainEvents))
    .useValue(new CapturingQueue(QueueName.DomainEvents))
    .overrideProvider(getQueueToken(QueueName.Mail))
    .useValue(mail)
    .compile();

  const app = await configureHttpApp(
    moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter()),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    database,
    redis,
    mail,
    clock,
    dependencies,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
};

/**
 * Simula o browser: guarda cookies entre requisições e envia o header CSRF (double-submit)
 * em métodos mutáveis, como o api-client do web faz.
 */
export class BrowserSession {
  readonly cookies = new Map<string, string>();

  constructor(private readonly app: NestFastifyApplication) {}

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options: { body?: unknown; csrf?: boolean; headers?: Record<string, string> } = {},
  ): Promise<InjectResponse> {
    const mutating = method !== 'GET';
    const csrf = this.cookies.get('f4d_csrf');
    const response = await this.app.inject({
      method,
      url,
      headers: {
        origin: WEB_ORIGIN,
        ...(mutating && options.csrf !== false && csrf ? { 'x-csrf-token': csrf } : {}),
        ...options.headers,
      },
      cookies: Object.fromEntries(this.cookies),
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });
    for (const cookie of response.cookies as {
      name: string;
      value: string;
      maxAge?: number;
      expires?: Date;
    }[]) {
      const expired =
        cookie.maxAge === 0 || (cookie.expires && cookie.expires.getTime() <= Date.now());
      if (expired || cookie.value === '') this.cookies.delete(cookie.name);
      else this.cookies.set(cookie.name, cookie.value);
    }
    return response;
  }

  /** Primeiro passo do web: obter o cookie CSRF. */
  async init(): Promise<this> {
    await this.request('GET', '/v1/auth/csrf');
    return this;
  }
}

/** Extrai o token do último e-mail capturado para `to` com a tag informada. */
export const lastEmailToken = (
  mail: CapturingQueue<EmailMessage>,
  to: string,
  tag: string,
): string => {
  const job = [...mail.jobs].reverse().find((j) => j.data.to === to && j.data.tag === tag);
  const token = job?.data.text.match(/token=([\w-]+)/)?.[1];
  if (!token) throw new Error(`Nenhum e-mail ${tag} para ${to}`);
  return token;
};
