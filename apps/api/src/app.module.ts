import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './modules/health/health.module.js';
import { ConfigModule, ENV } from './shared/config/config.module.js';
import type { Env } from './shared/config/env.js';
import { DatabaseModule } from './shared/infra/database/database.module.js';
import { LoggerModule } from './shared/infra/logger/logger.module.js';
import { QueueModule } from './shared/infra/queue/queue.module.js';
import { OpenApiController } from './shared/interface/http/openapi.controller.js';
import { ProblemDetailsFilter } from './shared/interface/http/problem-details.filter.js';
import { ResponseContractInterceptor } from './shared/interface/http/response-contract.interceptor.js';

/** Módulos comuns aos processos http e worker. */
export const infrastructureModules = [ConfigModule, LoggerModule, DatabaseModule, QueueModule];

@Module({
  imports: [
    ...infrastructureModules,
    // Limite global por IP. Em F1 o storage passa para Redis (limite compartilhado entre réplicas)
    // e rotas sensíveis (login, cadastro, mensagens) ganham limites próprios.
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => [
        { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE },
      ],
    }),
    HealthModule,
  ],
  controllers: [OpenApiController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseContractInterceptor },
  ],
})
export class AppModule {}
