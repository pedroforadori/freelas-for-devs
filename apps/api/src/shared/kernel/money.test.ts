import { describe, expect, it } from 'vitest';
import { Money } from './money.js';

describe('Money', () => {
  it('rejects fractional and negative cents', () => {
    expect(() => Money.ofCents(10.5)).toThrow(RangeError);
    expect(() => Money.ofCents(-1)).toThrow(RangeError);
  });

  it('computes the 10% launch commission in basis points', () => {
    expect(Money.ofCents(150_000).percentage(1_000).cents).toBe(15_000);
  });

  it('rounds half up to the cent', () => {
    // 10% de R$ 0,05 = 0,5 centavo → 1 centavo
    expect(Money.ofCents(5).percentage(1_000).cents).toBe(1);
  });

  it('allocates without losing cents', () => {
    const parts = Money.ofCents(100).allocate([1, 1, 1]);
    expect(parts.map((p) => p.cents)).toEqual([34, 33, 33]);
    expect(parts.reduce((sum, p) => sum + p.cents, 0)).toBe(100);
  });

  it('supports partial dispute releases (e.g. 70/30)', () => {
    const [freelancer, refund] = Money.ofCents(99_999).allocate([70, 30]);
    expect((freelancer?.cents ?? 0) + (refund?.cents ?? 0)).toBe(99_999);
    expect(freelancer?.cents).toBe(70_000);
  });

  it('skips zero-weight parts when distributing the remainder', () => {
    expect(
      Money.ofCents(10)
        .allocate([0, 1, 2])
        .map((p) => p.cents),
    ).toEqual([0, 4, 6]);
  });

  it('prevents negative results on subtraction', () => {
    expect(() => Money.ofCents(1).subtract(Money.ofCents(2))).toThrow(RangeError);
  });
});
