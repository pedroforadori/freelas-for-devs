import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { FailOpen } from './fail-open.js';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Contadores de rate limit no Redis: o limite vale para o conjunto de réplicas da API,
 * não por processo. Janela fixa por chave (IP + rota), com bloqueio após estourar.
 * Com o Redis fora do ar, deixa passar (fail-open) em vez de travar ou recusar tudo.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly failOpen = new FailOpen('RateLimit');

  constructor(private readonly redis: Redis) {}

  increment(
    key: string,
    ttlMs: number,
    limit: number,
    blockDurationMs: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    return this.failOpen.run(() => this.count(key, ttlMs, limit, blockDurationMs, throttlerName), {
      totalHits: 0,
      timeToExpire: Math.ceil(ttlMs / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  }

  private async count(
    key: string,
    ttlMs: number,
    limit: number,
    blockDurationMs: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `f4d:rl:${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:block`;
    const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

    const blockedMs = await this.redis.pttl(blockKey);
    if (blockedMs > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: seconds(blockedMs),
        isBlocked: true,
        timeToBlockExpire: seconds(blockedMs),
      };
    }

    const results = await this.redis.multi().incr(hitsKey).pttl(hitsKey).exec();
    const hits = Number(results?.[0]?.[1] ?? 1);
    let remainingMs = Number(results?.[1]?.[1] ?? -1);
    if (remainingMs < 0) {
      await this.redis.pexpire(hitsKey, ttlMs);
      remainingMs = ttlMs;
    }

    if (hits > limit) {
      await this.redis.set(blockKey, '1', 'PX', blockDurationMs);
      return {
        totalHits: hits,
        timeToExpire: seconds(remainingMs),
        isBlocked: true,
        timeToBlockExpire: seconds(blockDurationMs),
      };
    }
    return {
      totalHits: hits,
      timeToExpire: seconds(remainingMs),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
