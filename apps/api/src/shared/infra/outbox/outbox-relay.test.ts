import { describe, expect, it } from 'vitest';
import type { EventDispatcher } from '../../application/event-dispatcher.js';
import type { DomainEvent } from '../../kernel/domain-event.js';
import { OutboxRelay, type OutboxStore, type RelayOutcome } from './outbox-relay.js';

const event = (id: string): DomainEvent => ({
  id,
  type: 'SampleHappened',
  aggregateType: 'Sample',
  aggregateId: 'agg-1',
  occurredAt: new Date('2026-01-01T00:00:00Z'),
  payload: {},
});

class InMemoryOutboxStore implements OutboxStore {
  readonly published = new Set<string>();
  readonly failures = new Map<string, string>();

  constructor(private readonly pending: DomainEvent[]) {}

  async processBatch(
    limit: number,
    handle: (events: DomainEvent[]) => Promise<RelayOutcome[]>,
  ): Promise<RelayOutcome[]> {
    const batch = this.pending.filter((e) => !this.published.has(e.id)).slice(0, limit);
    const outcomes = await handle(batch);
    for (const outcome of outcomes) {
      if (outcome.status === 'published') this.published.add(outcome.id);
      else this.failures.set(outcome.id, outcome.error);
    }
    return outcomes;
  }
}

class RecordingDispatcher implements EventDispatcher {
  readonly delivered: string[] = [];
  constructor(private readonly failingIds: ReadonlySet<string> = new Set()) {}

  dispatch(e: DomainEvent): Promise<void> {
    if (this.failingIds.has(e.id)) return Promise.reject(new Error('redis indisponível'));
    this.delivered.push(e.id);
    return Promise.resolve();
  }
}

describe('OutboxRelay', () => {
  it('publishes pending events in order, respecting the batch size', async () => {
    const store = new InMemoryOutboxStore([event('a'), event('b'), event('c')]);
    const dispatcher = new RecordingDispatcher();
    const relay = new OutboxRelay(store, dispatcher, 2);

    expect(await relay.relayOnce()).toEqual({ published: 2, failed: 0 });
    expect(await relay.relayOnce()).toEqual({ published: 1, failed: 0 });
    expect(dispatcher.delivered).toEqual(['a', 'b', 'c']);
  });

  it('isolates failures and retries them on the next cycle', async () => {
    const store = new InMemoryOutboxStore([event('a'), event('b')]);
    const relay = new OutboxRelay(store, new RecordingDispatcher(new Set(['a'])), 10);

    expect(await relay.relayOnce()).toEqual({ published: 1, failed: 1 });
    expect(store.failures.get('a')).toBe('redis indisponível');

    const recovered = new OutboxRelay(store, new RecordingDispatcher(), 10);
    expect(await recovered.relayOnce()).toEqual({ published: 1, failed: 0 });
    expect(store.published).toEqual(new Set(['a', 'b']));
  });

  it('does nothing when the outbox is empty', async () => {
    const relay = new OutboxRelay(new InMemoryOutboxStore([]), new RecordingDispatcher(), 10);
    expect(await relay.relayOnce()).toEqual({ published: 0, failed: 0 });
  });
});
