import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { ContractsModule } from './modules/contracts/contracts.module.js';
import { DistributionModule } from './modules/distribution/distribution.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { LeadsModule } from './modules/leads/leads.module.js';
import { MessagingModule } from './modules/messaging/messaging.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { ReputationModule } from './modules/reputation/reputation.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ConfigModule, ENV } from './shared/config/config.module.js';
import type { Env } from './shared/config/env.js';
import { CoreModule } from './shared/infra/core.module.js';
import { DatabaseModule } from './shared/infra/database/database.module.js';
import { LoggerModule } from './shared/infra/logger/logger.module.js';
import { MailModule } from './shared/infra/mail/mail.module.js';
import { QueueModule, REDIS } from './shared/infra/queue/queue.module.js';
import { RedisThrottlerStorage } from './shared/infra/rate-limit/redis-throttler.storage.js';
import { AuthGuard } from './shared/interface/http/auth/auth.guard.js';
import { CsrfGuard } from './shared/interface/http/auth/csrf.guard.js';
import { OpenApiController } from './shared/interface/http/openapi.controller.js';
import { ProblemDetailsFilter } from './shared/interface/http/problem-details.filter.js';
import { ResponseContractInterceptor } from './shared/interface/http/response-contract.interceptor.js';

/** Módulos comuns aos processos http e worker. */
export const infrastructureModules = [
  ConfigModule,
  LoggerModule,
  DatabaseModule,
  QueueModule,
  CoreModule,
];

@Module({
  imports: [
    ...infrastructureModules,
    MailModule,
    // Limite global por IP, compartilhado entre réplicas via Redis. Rotas sensíveis
    // (login, cadastro, reset) declaram limites próprios com @Throttle.
    ThrottlerModule.forRootAsync({
      inject: [ENV, REDIS],
      useFactory: (env: Env, redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    HealthModule,
    IdentityModule,
    ProfilesModule,
    FilesModule,
    LeadsModule,
    ProjectsModule,
    SettingsModule,
    DistributionModule,
    ContractsModule,
    MessagingModule,
    ReputationModule,
    PrivacyModule,
  ],
  controllers: [OpenApiController],
  providers: [
    // Ordem importa: rate limit → CSRF → autenticação/RBAC.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseContractInterceptor },
  ],
})
export class AppModule {}
