import { asc, inArray, isNull, sql } from 'drizzle-orm';
import { outboxEvents } from '../../../db/schema/outbox.js';
import type { DomainEvent, IdGenerator, PendingDomainEvent } from '../../kernel/domain-event.js';
import type { Database, DbExecutor } from '../database/database-context.js';
import type { OutboxStore, RelayOutcome } from './outbox-relay.js';

/** Atribui ids (UUIDv7) aos eventos registrados pelos agregados. */
export const assignEventIds = (
  events: readonly PendingDomainEvent[],
  ids: IdGenerator,
): DomainEvent[] => events.map((event) => ({ ...event, id: ids.next() }));

/** Grava eventos de domínio no outbox usando o executor da transação corrente. */
export const appendToOutbox = async (executor: DbExecutor, events: readonly DomainEvent[]) => {
  if (events.length === 0) return;
  await executor.insert(outboxEvents).values(
    events.map((event) => ({
      id: event.id,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      occurredAt: event.occurredAt,
    })),
  );
};

export class DrizzleOutboxStore implements OutboxStore {
  constructor(private readonly db: Database) {}

  processBatch(
    limit: number,
    handle: (events: DomainEvent[]) => Promise<RelayOutcome[]>,
  ): Promise<RelayOutcome[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit)
        .for('update', { skipLocked: true });

      if (rows.length === 0) return [];

      const outcomes = await handle(
        rows.map((row) => ({
          id: row.id,
          type: row.type,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          occurredAt: row.occurredAt,
          payload: row.payload,
        })),
      );

      const publishedIds = outcomes.filter((o) => o.status === 'published').map((o) => o.id);
      if (publishedIds.length > 0) {
        await tx
          .update(outboxEvents)
          .set({
            publishedAt: sql`now()`,
            attempts: sql`${outboxEvents.attempts} + 1`,
            lastError: null,
          })
          .where(inArray(outboxEvents.id, publishedIds));
      }
      for (const outcome of outcomes) {
        if (outcome.status !== 'failed') continue;
        await tx
          .update(outboxEvents)
          .set({
            attempts: sql`${outboxEvents.attempts} + 1`,
            lastError: outcome.error.slice(0, 2000),
          })
          .where(inArray(outboxEvents.id, [outcome.id]));
      }
      return outcomes;
    });
  }
}
