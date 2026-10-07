import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { HealthIndicator } from '../application/check-readiness.js';

export class PostgresHealthIndicator implements HealthIndicator {
  readonly name = 'postgres';
  constructor(private readonly pool: pg.Pool) {}

  async isHealthy(): Promise<boolean> {
    const result = await this.pool.query<{ ok: number }>('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  }
}

export class RedisHealthIndicator implements HealthIndicator {
  readonly name = 'redis';
  constructor(private readonly redis: Redis) {}

  async isHealthy(): Promise<boolean> {
    // Sem fila offline, o ping falha na hora se a conexão estiver caída.
    return (await this.redis.ping()) === 'PONG';
  }
}
