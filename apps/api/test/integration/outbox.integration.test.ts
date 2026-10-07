import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema/index.js';
import { outboxEvents } from '../../src/db/schema/outbox.js';
import type { EventDispatcher } from '../../src/shared/application/event-dispatcher.js';
import {
  type Database,
  DatabaseContext,
} from '../../src/shared/infra/database/database-context.js';
import { UuidV7Generator } from '../../src/shared/infra/id/uuid-v7.generator.js';
import {
  appendToOutbox,
  DrizzleOutboxStore,
} from '../../src/shared/infra/outbox/drizzle-outbox.store.js';
import { OutboxRelay } from '../../src/shared/infra/outbox/outbox-relay.js';
import type { DomainEvent } from '../../src/shared/kernel/domain-event.js';

/** Requer Docker (Testcontainers). Roda no CI e localmente com Docker/OrbStack. */
let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let db: Database;
const ids = new UuidV7Generator();

const event = (): DomainEvent => ({
  id: ids.next(),
  type: 'SampleHappened',
  aggregateType: 'Sample',
  aggregateId: 'agg-1',
  occurredAt: new Date(),
  payload: { answer: 42 },
});

const collectingDispatcher = (delivered: string[], delayMs = 0): EventDispatcher => ({
  dispatch: async (e) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    delivered.push(e.id);
  },
});

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 10 });
  db = drizzle({ client: pool, schema, casing: 'snake_case' });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../src/db/migrations', import.meta.url)),
  });
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  await db.delete(outboxEvents);
});

describe('outbox (Postgres)', () => {
  it('writes events atomically with the surrounding unit of work', async () => {
    const ctx = new DatabaseContext(db);

    await expect(
      ctx.run(async () => {
        await appendToOutbox(ctx.executor, [event()]);
        throw new Error('regra de negócio falhou depois de gravar');
      }),
    ).rejects.toThrow();
    expect(await db.select().from(outboxEvents)).toHaveLength(0);

    await ctx.run(() => appendToOutbox(ctx.executor, [event(), event()]));
    expect(await db.select().from(outboxEvents)).toHaveLength(2);
  });

  it('publishes each event exactly once across concurrent relays (SKIP LOCKED)', async () => {
    const events = Array.from({ length: 50 }, event);
    await appendToOutbox(db, events);

    const delivered: string[] = [];
    const relays = Array.from(
      { length: 4 },
      () => new OutboxRelay(new DrizzleOutboxStore(db), collectingDispatcher(delivered, 2), 10),
    );

    for (let round = 0; round < 5; round += 1) {
      await Promise.all(relays.map((relay) => relay.relayOnce()));
    }

    expect(delivered).toHaveLength(50);
    expect(new Set(delivered).size).toBe(50);
    const rows = await db.select().from(outboxEvents);
    expect(rows.every((row) => row.publishedAt !== null && row.attempts === 1)).toBe(true);
  });

  it('records failures and keeps the event pending for retry', async () => {
    const failing = event();
    await appendToOutbox(db, [failing]);
    const broken: EventDispatcher = {
      dispatch: () => Promise.reject(new Error('redis fora do ar')),
    };

    expect(await new OutboxRelay(new DrizzleOutboxStore(db), broken, 10).relayOnce()).toEqual({
      published: 0,
      failed: 1,
    });

    const [row] = await db.select().from(outboxEvents);
    expect(row).toMatchObject({ publishedAt: null, attempts: 1, lastError: 'redis fora do ar' });
  });
});
