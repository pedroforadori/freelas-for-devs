import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Transactional Outbox (ADR-0003): eventos de domínio gravados na mesma transação do agregado
 * e publicados de forma assíncrona pelo relay do worker.
 */
export const outboxEvents = pgTable(
  'outbox_event',
  {
    id: uuid().primaryKey(),
    type: text().notNull(),
    aggregateType: text().notNull(),
    aggregateId: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (table) => [
    index('outbox_event_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.publishedAt} IS NULL`),
    index('outbox_event_aggregate_idx').on(table.aggregateType, table.aggregateId),
  ],
);

export type OutboxEventRow = typeof outboxEvents.$inferSelect;
export type NewOutboxEventRow = typeof outboxEvents.$inferInsert;
