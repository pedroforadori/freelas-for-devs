import { BullModule } from '@nestjs/bullmq';
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { EVENT_DISPATCHER } from '../../application/event-dispatcher.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { BullMqEventDispatcher } from './bullmq-event-dispatcher.js';
import { QueueErrorReporter } from './queue-error-reporter.js';
import { QueueName } from './queue-names.js';

export const REDIS = Symbol('REDIS');

const redisOptions = (env: Env) => {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
};

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        // Exigido pelo BullMQ para conexões bloqueantes dos workers.
        connection: { ...redisOptions(env), maxRetriesPerRequest: null },
        prefix: 'f4d',
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 24 * 3600, count: 10_000 },
          removeOnFail: { age: 14 * 24 * 3600 },
        },
      }),
    }),
    BullModule.registerQueue({ name: QueueName.DomainEvents }),
  ],
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => {
        // Cliente da aplicação (rate limit, bloqueio de login, health): falha rápido.
        // Diferente das conexões do BullMQ, nunca enfileira comandos à espera de reconexão —
        // com o Redis fora, uma requisição HTTP não pode ficar pendurada.
        const redis = new Redis({
          ...redisOptions(env),
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          commandTimeout: 500,
          connectTimeout: 2_000,
        });
        // Falhas de conexão são reportadas pelo readiness; sem listener o ioredis imprime stack cru.
        redis.on('error', () => undefined);
        return redis;
      },
    },
    { provide: EVENT_DISPATCHER, useClass: BullMqEventDispatcher },
    QueueErrorReporter,
  ],
  exports: [BullModule, REDIS, EVENT_DISPATCHER],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') await this.redis.quit().catch(() => undefined);
  }
}
