import { describe, expect, it } from 'vitest';
import { AggregateRoot } from './aggregate-root.js';

class Counter extends AggregateRoot {
  static create(id: string): Counter {
    return new Counter(id, 0);
  }

  increment(): void {
    this.record({
      id: `evt-${this.version}`,
      type: 'CounterIncremented',
      aggregateType: 'Counter',
      aggregateId: this.id,
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      payload: {},
    });
  }
}

describe('AggregateRoot', () => {
  it('collects and drains pending events', () => {
    const counter = Counter.create('c-1');
    counter.increment();
    counter.increment();
    expect(counter.pullEvents()).toHaveLength(2);
    expect(counter.pullEvents()).toHaveLength(0);
  });

  it('bumps the version only after persistence', () => {
    const counter = Counter.create('c-1');
    counter.increment();
    expect(counter.version).toBe(0);
    counter.markPersisted();
    expect(counter.version).toBe(1);
  });
});
