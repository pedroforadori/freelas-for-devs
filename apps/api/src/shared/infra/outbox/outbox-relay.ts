import type { EventDispatcher } from '../../application/event-dispatcher.js';
import type { DomainEvent } from '../../kernel/domain-event.js';

export type RelayOutcome =
  | { readonly id: string; readonly status: 'published' }
  | { readonly id: string; readonly status: 'failed'; readonly error: string };

/**
 * Acesso ao outbox. `processBatch` reivindica um lote (FOR UPDATE SKIP LOCKED), entrega-o ao
 * callback e grava os resultados — tudo na mesma transação, para que réplicas do worker
 * nunca processem o mesmo evento em paralelo.
 */
export interface OutboxStore {
  processBatch(
    limit: number,
    handle: (events: DomainEvent[]) => Promise<RelayOutcome[]>,
  ): Promise<RelayOutcome[]>;
}

export interface RelaySummary {
  published: number;
  failed: number;
}

/**
 * Publica eventos pendentes do outbox. Falhas de um evento não bloqueiam os demais;
 * o evento volta a ser tentado no próximo ciclo. A entrega é at-least-once: o dispatcher
 * deduplica por `event.id`.
 */
export class OutboxRelay {
  constructor(
    private readonly store: OutboxStore,
    private readonly dispatcher: EventDispatcher,
    private readonly batchSize: number,
  ) {}

  async relayOnce(): Promise<RelaySummary> {
    const outcomes = await this.store.processBatch(this.batchSize, async (events) => {
      const results: RelayOutcome[] = [];
      for (const event of events) {
        try {
          await this.dispatcher.dispatch(event);
          results.push({ id: event.id, status: 'published' });
        } catch (error) {
          results.push({
            id: event.id,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return results;
    });

    return {
      published: outcomes.filter((o) => o.status === 'published').length,
      failed: outcomes.filter((o) => o.status === 'failed').length,
    };
  }
}
