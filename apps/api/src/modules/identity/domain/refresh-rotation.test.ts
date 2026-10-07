import { describe, expect, it } from 'vitest';
import { decideRotation, type RefreshTokenState } from './refresh-rotation.js';

const now = new Date('2026-03-01T12:00:00Z');
const token = (overrides: Partial<RefreshTokenState> = {}): RefreshTokenState => ({
  id: 't1',
  userId: 'u1',
  familyId: 'f1',
  expiresAt: new Date('2026-03-31T12:00:00Z'),
  rotatedAt: null,
  revokedAt: null,
  ...overrides,
});

describe('decideRotation', () => {
  it('rotates a fresh token', () => {
    expect(decideRotation(token(), now)).toEqual({ kind: 'rotate' });
  });

  it('flags reuse of an already rotated token as theft', () => {
    const rotatedAt = new Date(now.getTime() - 60_000);
    expect(decideRotation(token({ rotatedAt }), now)).toEqual({ kind: 'reuse-detected' });
  });

  it('tolerates two tabs refreshing at the same time', () => {
    const rotatedAt = new Date(now.getTime() - 2_000);
    expect(decideRotation(token({ rotatedAt }), now)).toEqual({ kind: 'superseded' });
  });

  it('rejects expired and revoked tokens', () => {
    expect(decideRotation(token({ expiresAt: now }), now)).toEqual({ kind: 'expired' });
    expect(decideRotation(token({ revokedAt: now }), now)).toEqual({ kind: 'revoked' });
  });
});
