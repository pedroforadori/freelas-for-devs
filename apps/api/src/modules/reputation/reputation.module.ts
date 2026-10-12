import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AUDIT_LOGGER, type AuditLogger } from '../../shared/application/audit-log.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import { ID_GENERATOR } from '../../shared/infra/id/uuid-v7.generator.js';
import { QueueName } from '../../shared/infra/queue/queue-names.js';
import type { Clock } from '../../shared/kernel/clock.js';
import type { IdGenerator } from '../../shared/kernel/domain-event.js';
import { ProfilesFacade } from '../profiles/application/facade.js';
import { ProfilesModule, ProfilesWorkerModule } from '../profiles/profiles.module.js';
import { REPUTATION_DEPS, type ReputationDeps } from './application/ports.js';
import { ManageLevelRules, ReadReputation, RecomputeReputation } from './application/use-cases.js';
import {
  DrizzleLevelHistoryReader,
  DrizzleLevelRules,
  DrizzleReputationSource,
  DrizzleStatsStore,
} from './infrastructure/drizzle-reputation.js';
import {
  AdminReputationController,
  ReputationController,
} from './interface/reputation.controller.js';
import {
  ReputationEventHandler,
  ReputationNightlyProcessor,
} from './interface/reputation.worker.js';

const USE_CASES = [RecomputeReputation, ReadReputation, ManageLevelRules] as const;

const sharedProviders = [
  {
    provide: REPUTATION_DEPS,
    inject: [DatabaseContext, ID_GENERATOR, CLOCK, AUDIT_LOGGER, ProfilesFacade],
    useFactory: (
      ctx: DatabaseContext,
      ids: IdGenerator,
      clock: Clock,
      audit: AuditLogger,
      profiles: ProfilesFacade,
    ): ReputationDeps => ({
      source: new DrizzleReputationSource(ctx),
      stats: new DrizzleStatsStore(ctx, ids),
      levels: new DrizzleLevelRules(ctx),
      history: new DrizzleLevelHistoryReader(ctx),
      promoter: { promote: (input) => profiles.promote(input) },
      audit,
      uow: ctx,
      clock,
    }),
  },
  ...USE_CASES.map((UseCase) => ({
    provide: UseCase,
    inject: [REPUTATION_DEPS],
    useFactory: (deps: ReputationDeps) => new UseCase(deps),
  })),
];

/** Reputação e níveis (F9): estatísticas, score, progressão e regras por nível. */
@Module({
  imports: [ProfilesModule],
  controllers: [ReputationController, AdminReputationController],
  providers: sharedProviders,
})
export class ReputationModule {}

@Module({
  imports: [ProfilesWorkerModule, BullModule.registerQueue({ name: QueueName.Reputation })],
  providers: [...sharedProviders, ReputationEventHandler, ReputationNightlyProcessor],
})
export class ReputationWorkerModule {}
