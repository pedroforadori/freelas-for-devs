import RedisMock from 'ioredis-mock';
import { describe, expect, it } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

describe('RedisThrottlerStorage', () => {
  it('counts hits per key and blocks after the limit', async () => {
    const storage = new RedisThrottlerStorage(new RedisMock());
    const hit = () => storage.increment('ip:1', 60_000, 2, 30_000, 'login');

    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(await hit()).toMatchObject({ totalHits: 2, isBlocked: false });
    expect(await hit()).toMatchObject({ isBlocked: true, timeToBlockExpire: 30 });
    expect(await hit()).toMatchObject({ isBlocked: true });
    expect(await storage.increment('ip:2', 60_000, 2, 30_000, 'login')).toMatchObject({
      isBlocked: false,
    });
  });
});

describe('RedisThrottlerStorage when Redis is down', () => {
  it('lets requests through instead of hanging or failing (fail-open)', async () => {
    const broken = new Proxy({}, { get: () => () => Promise.reject(new Error('ECONNREFUSED')) });
    const storage = new RedisThrottlerStorage(broken as never);
    await expect(storage.increment('ip:1', 60_000, 2, 30_000, 'default')).resolves.toMatchObject({
      isBlocked: false,
    });
  });
});
