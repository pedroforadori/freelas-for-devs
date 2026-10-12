import { Module } from '@nestjs/common';
import { AUDIT_LOGGER, type AuditLogger } from '../../shared/application/audit-log.js';
import { MAILER, type Mailer } from '../../shared/application/mailer.js';
import { ENV } from '../../shared/config/config.module.js';
import type { Env } from '../../shared/config/env.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import { ID_GENERATOR } from '../../shared/infra/id/uuid-v7.generator.js';
import type { Clock } from '../../shared/kernel/clock.js';
import type { IdGenerator } from '../../shared/kernel/domain-event.js';
import { ProfilesFacade } from './application/facade.js';
import { PROFILES_DEPS, type ProfilesDeps } from './application/ports.js';
import {
  GetMyFreelancerProfile,
  ListFreelancersForReview,
  ManageClientProfile,
  ManagePortfolio,
  ReviewFreelancerProfile,
  SubmitFreelancerProfile,
  UpdateMyFreelancerProfile,
} from './application/use-cases.js';
import {
  DrizzleCatalog,
  DrizzleClientProfileRepository,
  DrizzleFreelancerProfileRepository,
  DrizzleLevelHistory,
  DrizzlePeopleDirectory,
  DrizzleReviewQueue,
} from './infrastructure/drizzle-profiles.js';
import { AdminProfilesController, ProfilesController } from './interface/profiles.controller.js';

const USE_CASES = [
  GetMyFreelancerProfile,
  UpdateMyFreelancerProfile,
  ManagePortfolio,
  SubmitFreelancerProfile,
  ReviewFreelancerProfile,
  ListFreelancersForReview,
  ManageClientProfile,
  ProfilesFacade,
] as const;

const sharedProviders = [
  {
    provide: PROFILES_DEPS,
    inject: [ENV, DatabaseContext, ID_GENERATOR, CLOCK, AUDIT_LOGGER, MAILER],
    useFactory: (
      env: Env,
      ctx: DatabaseContext,
      ids: IdGenerator,
      clock: Clock,
      audit: AuditLogger,
      mailer: Mailer,
    ): ProfilesDeps => ({
      profiles: new DrizzleFreelancerProfileRepository(ctx, ids),
      clients: new DrizzleClientProfileRepository(ctx),
      catalog: new DrizzleCatalog(ctx),
      levelHistory: new DrizzleLevelHistory(ctx),
      people: new DrizzlePeopleDirectory(ctx),
      reviewQueue: new DrizzleReviewQueue(ctx),
      mailer,
      audit,
      uow: ctx,
      clock,
      ids,
      webAppUrl: env.WEB_APP_URL,
    }),
  },
  ...USE_CASES.map((UseCase) => ({
    provide: UseCase,
    inject: [PROFILES_DEPS],
    useFactory: (deps: ProfilesDeps) => new UseCase(deps),
  })),
];

@Module({
  controllers: [ProfilesController, AdminProfilesController],
  providers: sharedProviders,
  exports: [ProfilesFacade],
})
export class ProfilesModule {}

/** Sem controllers: a reputação (worker) promove freelancers pela fachada. */
@Module({ providers: sharedProviders, exports: [ProfilesFacade] })
export class ProfilesWorkerModule {}
