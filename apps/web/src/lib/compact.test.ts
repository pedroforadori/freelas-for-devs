import { describe, expect, it } from 'vitest';
import { compact } from './compact';

describe('compact', () => {
  it('drops undefined keys at any depth, keeping arrays and falsy values', () => {
    expect(
      compact({ a: undefined, b: 0, c: '', d: { e: undefined, f: false }, g: [1, undefined] }),
    ).toEqual({
      b: 0,
      c: '',
      d: { f: false },
      g: [1, undefined],
    });
  });
});
