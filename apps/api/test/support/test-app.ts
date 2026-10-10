import { getQueueToken } from '@nestjs/bullmq';
import type { Type } from '@nestjs/common';
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
import { MALWARE_SCANNER, OBJECT_STORAGE } from '../../src/modules/files/files.module.js';
import { EicarScanner, InMemoryObjectStorage } from '../fakes/files.js';
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
  storage: InMemoryObjectStorage;
  fileScans: CapturingQueue<{ fileId: string }>;
  /** Relógio dos casos de uso (prazos, rotação). Começa no horário real. */
  clock: FakeClock;
  dependencies: { postgres: boolean; redis: boolean };
  close(): Promise<void>;
}

/**
 * Aplicação HTTP real (guards, filtros, cookies, rate limit) com dependências em processo:
 * Postgres = PGlite, Redis = ioredis-mock, filas BullMQ = captura em memória. Roda sem Docker.
 */
export const createTestApp = async (
  env: Record<string, string> = {},
  options: { controllers?: Type[]; overrides?: { token: unknown; value: unknown }[] } = {},
): Promise<TestApp> => {
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
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test',
    ...env,
  });

  const database = await createTestDatabase();
  const redis = new RedisMock();
  const mail = new CapturingQueue<EmailMessage>(QueueName.Mail);
  const storage = new InMemoryObjectStorage();
  const fileScans = new CapturingQueue<{ fileId: string }>(QueueName.Files);
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

  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
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
    .overrideProvider(getQueueToken(QueueName.Files))
    .useValue(fileScans)
    .overrideProvider(OBJECT_STORAGE)
    .useValue(storage)
    .overrideProvider(MALWARE_SCANNER)
    .useValue(new EicarScanner());
  for (const { token, value } of options.overrides ?? []) {
    builder = builder.overrideProvider(token as string).useValue(value);
  }
  const moduleRef = await builder.compile();

  const app = await configureHttpApp(
    moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), {
      rawBody: true,
    }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    database,
    redis,
    mail,
    storage,
    fileScans,
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

let adminCounter = 0;

/**
 * Admin pronto para usar o painel: provisionado via caso de uso (como o CLI faz), com senha
 * definida e 2FA ativo — sessão nível 2.
 */
export const createAdminSession = async (t: TestApp): Promise<BrowserSession> => {
  const { ProvisionAdmin } =
    await import('../../src/modules/identity/application/admin-use-cases.js');
  const { totpCodeAt } = await import('../fakes/identity.js');
  const email = `admin${(adminCounter += 1)}@freelas4devs.test`;
  const password = 'cavalo correto bateria grampo';

  const provisioned = await t.app.get(ProvisionAdmin).execute({ email, displayName: 'Admin' });
  const token = new URL(provisioned.passwordSetupUrl).searchParams.get('token')!;
  const admin = await new BrowserSession(t.app).init();
  await admin.request('POST', '/v1/auth/password/reset', { body: { token, password } });
  await admin.request('POST', '/v1/auth/login', { body: { email, password } });
  const { secret } = (await admin.request('POST', '/v1/auth/mfa/setup')).json<{ secret: string }>();
  await admin.request('POST', '/v1/auth/mfa/enable', {
    body: { code: totpCodeAt(secret, t.clock.now()) },
  });
  return admin;
};
