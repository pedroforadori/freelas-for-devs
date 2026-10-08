import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps custom font sizes alongside text colors', () => {
    expect(cn('text-lead text-dark', 'text-white')).toBe('text-lead text-white');
    expect(cn('text-body', 'text-h4')).toBe('text-h4');
  });
});
