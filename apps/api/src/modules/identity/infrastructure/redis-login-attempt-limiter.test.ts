import RedisMock from 'ioredis-mock';
import { describe, expect, it } from 'vitest';
import { RedisLoginAttemptLimiter } from './redis-login-attempt-limiter.js';

const policy = { maxFailures: 3, windowSeconds: 900, lockSeconds: 60, maxLockSeconds: 300 };

describe('RedisLoginAttemptLimiter', () => {
  it('locks after repeated failures and escalates the lock', async () => {
    const redis = new RedisMock();
    const limiter = new RedisLoginAttemptLimiter(redis, policy);
    const key = 'login:ana@exemplo.com';

    for (let i = 0; i < 2; i += 1) await limiter.registerFailure(key);
    expect(await limiter.lockedFor(key)).toBe(0);
    await limiter.registerFailure(key);
    expect(await limiter.lockedFor(key)).toBeGreaterThan(55);

    // Simula o fim do primeiro bloqueio: a próxima série de falhas bloqueia pelo dobro.
    await redis.del(...(await redis.keys('f4d:auth:lock:*')));
    expect(await limiter.lockedFor(key)).toBe(0);
    for (let i = 0; i < 3; i += 1) await limiter.registerFailure(key);
    expect(await limiter.lockedFor(key)).toBeGreaterThan(115);
  });

  it('never stores the e-mail in clear text', async () => {
    const redis = new RedisMock();
    await new RedisLoginAttemptLimiter(redis, policy).registerFailure('login:ana@exemplo.com');
    const keys = await redis.keys('*');
    expect(keys.join(' ')).not.toContain('ana@');
  });

  it('clears failures after a successful login', async () => {
    const redis = new RedisMock();
    const limiter = new RedisLoginAttemptLimiter(redis, policy);
    await limiter.registerFailure('k');
    await limiter.registerFailure('k');
    await limiter.reset('k');
    await limiter.registerFailure('k');
    expect(await limiter.lockedFor('k')).toBe(0);
  });
});
