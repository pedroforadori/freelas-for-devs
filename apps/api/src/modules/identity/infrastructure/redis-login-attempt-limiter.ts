import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { FailOpen } from '../../../shared/infra/rate-limit/fail-open.js';
import type { LoginAttemptLimiter } from '../application/ports.js';

export interface LoginLimiterPolicy {
  /** Falhas toleradas dentro da janela antes de bloquear. */
  maxFailures: number;
  windowSeconds: number;
  /** Bloqueio inicial; dobra a cada novo bloqueio até `maxLockSeconds`. */
  lockSeconds: number;
  maxLockSeconds: number;
}

export const DEFAULT_LOGIN_POLICY: LoginLimiterPolicy = {
  maxFailures: 5,
  windowSeconds: 15 * 60,
  lockSeconds: 5 * 60,
  maxLockSeconds: 60 * 60,
};

/**
 * Bloqueio progressivo por conta (não por IP): resiste a ataques distribuídos contra um e-mail.
 * As chaves usam hash do e-mail — o Redis não guarda dados pessoais em claro.
 * Sem Redis, o login continua funcionando sem o bloqueio (fail-open); o rate limit por IP
 * e o custo do argon2 seguem limitando força bruta durante a indisponibilidade.
 */
export class RedisLoginAttemptLimiter implements LoginAttemptLimiter {
  private readonly failOpen = new FailOpen('LoginLimiter');

  constructor(
    private readonly redis: Redis,
    private readonly policy: LoginLimiterPolicy = DEFAULT_LOGIN_POLICY,
  ) {}

  lockedFor(key: string): Promise<number> {
    return this.failOpen.run(async () => {
      const ttl = await this.redis.ttl(this.lockKey(key));
      return ttl > 0 ? ttl : 0;
    }, 0);
  }

  registerFailure(key: string): Promise<void> {
    return this.failOpen.run(() => this.countFailure(key), undefined);
  }

  reset(key: string): Promise<void> {
    return this.failOpen.run(async () => {
      await this.redis.del(this.failuresKey(key), `${this.failuresKey(key)}:strikes`);
    }, undefined);
  }

  private async countFailure(key: string): Promise<void> {
    const failuresKey = this.failuresKey(key);
    const failures = await this.redis.incr(failuresKey);
    if (failures === 1) await this.redis.expire(failuresKey, this.policy.windowSeconds);
    if (failures < this.policy.maxFailures) return;

    const strikesKey = `${failuresKey}:strikes`;
    const strikes = await this.redis.incr(strikesKey);
    await this.redis.expire(strikesKey, 24 * 60 * 60);
    const lock = Math.min(this.policy.lockSeconds * 2 ** (strikes - 1), this.policy.maxLockSeconds);
    await this.redis.multi().set(this.lockKey(key), '1', 'EX', lock).del(failuresKey).exec();
  }

  private digest(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 32);
  }
  private failuresKey(key: string): string {
    return `f4d:auth:fail:${this.digest(key)}`;
  }
  private lockKey(key: string): string {
    return `f4d:auth:lock:${this.digest(key)}`;
  }
}
