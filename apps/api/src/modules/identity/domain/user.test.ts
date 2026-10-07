import { describe, expect, it } from 'vitest';
import { User, UserEvents } from './user.js';

const now = new Date('2026-03-01T12:00:00Z');
const register = () =>
  User.register({
    id: 'u1',
    email: '  Maria@Exemplo.com ',
    passwordHash: 'hash',
    displayName: ' Maria ',
    role: 'FREELANCER',
    now,
  });

describe('User', () => {
  it('normalizes data and emits a PII-free registration event', () => {
    const user = register();
    expect(user.email).toBe('maria@exemplo.com');
    expect(user.displayName).toBe('Maria');
    expect(user.permissions).toContain('profile:freelancer:write');
    const [event] = user.pullEvents();
    expect(event).toMatchObject({
      type: UserEvents.Registered,
      payload: { userId: 'u1', role: 'FREELANCER' },
    });
    expect(JSON.stringify(event?.payload)).not.toContain('maria@');
  });

  it('verifies the e-mail only once', () => {
    const user = register();
    user.pullEvents();
    user.verifyEmail(now);
    user.verifyEmail(now);
    expect(user.isEmailVerified).toBe(true);
    expect(user.pullEvents()).toHaveLength(1);
  });

  it('round-trips through a snapshot', () => {
    const user = register();
    const copy = User.rehydrate(user.toSnapshot());
    expect(copy.toSnapshot()).toEqual(user.toSnapshot());
  });
});
