import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { PG_POOL } from '../../shared/infra/database/database.module.js';
import { REDIS } from '../../shared/infra/queue/queue.module.js';
import {
  CheckReadiness,
  HEALTH_INDICATORS,
  type HealthIndicator,
} from './application/check-readiness.js';
import { PostgresHealthIndicator, RedisHealthIndicator } from './infrastructure/indicators.js';
import { HealthController } from './interface/health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: HEALTH_INDICATORS,
      inject: [PG_POOL, REDIS],
      useFactory: (pool: pg.Pool, redis: Redis): HealthIndicator[] => [
        new PostgresHealthIndicator(pool),
        new RedisHealthIndicator(redis),
      ],
    },
    {
      provide: CheckReadiness,
      inject: [HEALTH_INDICATORS],
      useFactory: (indicators: HealthIndicator[]) => new CheckReadiness(indicators),
    },
  ],
})
export class HealthModule {}
