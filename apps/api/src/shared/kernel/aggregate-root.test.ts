import { describe, expect, it } from 'vitest';
import { AggregateRoot } from './aggregate-root.js';

class Counter extends AggregateRoot {
  protected readonly aggregateType = 'Counter';

  static create(id: string): Counter {
    return new Counter(id, 0);
  }

  increment(now: Date): void {
    this.record('CounterIncremented', now, { by: 1 });
  }
}

const now = new Date('2026-01-01T00:00:00Z');

describe('AggregateRoot', () => {
  it('collects events with aggregate metadata and drains them', () => {
    const counter = Counter.create('c-1');
    counter.increment(now);
    counter.increment(now);

    const events = counter.pullEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: 'CounterIncremented',
      aggregateType: 'Counter',
      aggregateId: 'c-1',
      occurredAt: now,
      payload: { by: 1 },
    });
    expect(counter.pullEvents()).toHaveLength(0);
  });

  it('bumps the version only after persistence', () => {
    const counter = Counter.create('c-1');
    counter.increment(now);
    expect(counter.version).toBe(0);
    counter.markPersisted();
    expect(counter.version).toBe(1);
  });
});
