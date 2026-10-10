import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AUDIT_LOGGER, type AuditLogger } from '../../shared/application/audit-log.js';
import { MAILER, type Mailer } from '../../shared/application/mailer.js';
import { SETTINGS_READER, type SettingsReader } from '../../shared/application/settings-reader.js';
import { ENV } from '../../shared/config/config.module.js';
import type { Env } from '../../shared/config/env.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import { ID_GENERATOR } from '../../shared/infra/id/uuid-v7.generator.js';
import { QueueName } from '../../shared/infra/queue/queue-names.js';
import type { Clock } from '../../shared/kernel/clock.js';
import type { IdGenerator } from '../../shared/kernel/domain-event.js';
import { ProjectsFacade } from '../projects/application/facade.js';
import { ProjectsModule, ProjectsWorkerModule } from '../projects/projects.module.js';
import { DISTRIBUTION_DEPS, type DistributionDeps } from './application/ports.js';
import {
  CancelProjectRound,
  ExpireOverdueInvitations,
  FinalizeHiring,
  ManageQueue,
  OpenRound,
  ReadInvitations,
  ReadProjectProposals,
  RespondToInvitation,
  RevertSelection,
  SelectProposal,
  SyncQueueEntry,
} from './application/use-cases.js';
import {
  DrizzleDistributionPeople,
  DrizzleDistributionQueries,
  DrizzleQueueRepository,
  DrizzleRoundRepository,
} from './infrastructure/drizzle-distribution.js';
import {
  AdminDistributionController,
  DistributionController,
} from './interface/distribution.controller.js';
import {
  DistributionDeadlinesProcessor,
  DistributionEventHandler,
} from './interface/distribution.worker.js';

const USE_CASES = [
  SyncQueueEntry,
  OpenRound,
  RespondToInvitation,
  ExpireOverdueInvitations,
  SelectProposal,
  FinalizeHiring,
  CancelProjectRound,
  RevertSelection,
  ReadInvitations,
  ReadProjectProposals,
  ManageQueue,
] as const;

const sharedProviders = [
  {
    provide: DISTRIBUTION_DEPS,
    inject: [
      ENV,
      DatabaseContext,
      ID_GENERATOR,
      CLOCK,
      AUDIT_LOGGER,
      MAILER,
      SETTINGS_READER,
      ProjectsFacade,
    ],
    useFactory: (
      env: Env,
      ctx: DatabaseContext,
      ids: IdGenerator,
      clock: Clock,
      audit: AuditLogger,
      mailer: Mailer,
      settings: SettingsReader,
      projects: ProjectsFacade,
    ): DistributionDeps => ({
      rounds: new DrizzleRoundRepository(ctx, ids),
      queue: new DrizzleQueueRepository(ctx, ids),
      queries: new DrizzleDistributionQueries(ctx),
      projects,
      people: new DrizzleDistributionPeople(ctx),
      settings,
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
    inject: [DISTRIBUTION_DEPS],
    useFactory: (deps: DistributionDeps) => new UseCase(deps),
  })),
];

/** Fila justa, rodadas, convites e propostas (docs/architecture.md §6). */
@Module({
  imports: [ProjectsModule],
  controllers: [DistributionController, AdminDistributionController],
  providers: sharedProviders,
})
export class DistributionModule {}

@Module({
  imports: [ProjectsWorkerModule, BullModule.registerQueue({ name: QueueName.Distribution })],
  providers: [...sharedProviders, DistributionEventHandler, DistributionDeadlinesProcessor],
})
export class DistributionWorkerModule {}
