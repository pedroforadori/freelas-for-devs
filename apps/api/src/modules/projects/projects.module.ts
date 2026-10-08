import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AUDIT_LOGGER, type AuditLogger } from '../../shared/application/audit-log.js';
import { MAILER, type Mailer } from '../../shared/application/mailer.js';
import { ENV } from '../../shared/config/config.module.js';
import type { Env } from '../../shared/config/env.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import { ID_GENERATOR } from '../../shared/infra/id/uuid-v7.generator.js';
import { QueueName } from '../../shared/infra/queue/queue-names.js';
import type { Clock } from '../../shared/kernel/clock.js';
import type { IdGenerator } from '../../shared/kernel/domain-event.js';
import { PROJECTS_DEPS, type ProjectEstimator, type ProjectsDeps } from './application/ports.js';
import {
  AdminReadProjects,
  AnswerClarifications,
  CancelProject,
  CreateProject,
  FailEstimate,
  GenerateEstimate,
  ReadMyProjects,
} from './application/use-cases.js';
import {
  DrizzleAiRunLog,
  DrizzleAttachmentDirectory,
  DrizzleProjectCatalog,
  DrizzleProjectPeople,
  DrizzleProjectQueries,
  DrizzleProjectRepository,
} from './infrastructure/drizzle-projects.js';
import { ClaudeProjectEstimator } from './infrastructure/estimation/claude-estimator.js';
import { GeminiProjectEstimator } from './infrastructure/estimation/gemini-estimator.js';
import { HeuristicProjectEstimator } from './infrastructure/estimation/heuristic-estimator.js';
import {
  EstimationProcessor,
  RequestEstimateOnProjectChange,
} from './interface/estimation.worker.js';
import { AdminProjectsController, ProjectsController } from './interface/projects.controller.js';

export const PROJECT_ESTIMATOR = Symbol('PROJECT_ESTIMATOR');

const createEstimator = (env: Env): ProjectEstimator => {
  switch (env.ESTIMATOR) {
    case 'gemini':
      return new GeminiProjectEstimator(
        new GoogleGenAI({
          apiKey: env.GEMINI_API_KEY ?? '',
          // Retentativas ficam com o job (backoff e registro de cada chamada), não com o SDK.
          httpOptions: { timeout: env.ESTIMATOR_TIMEOUT_MS, retryOptions: { attempts: 1 } },
        }),
        env.GEMINI_MODEL,
      );
    case 'anthropic':
      return new ClaudeProjectEstimator(
        new Anthropic({
          apiKey: env.ANTHROPIC_API_KEY,
          timeout: env.ESTIMATOR_TIMEOUT_MS,
          maxRetries: 0,
        }),
        env.ANTHROPIC_MODEL,
      );
    case 'heuristic':
      return new HeuristicProjectEstimator();
  }
};

const USE_CASES = [
  CreateProject,
  ReadMyProjects,
  AnswerClarifications,
  CancelProject,
  GenerateEstimate,
  FailEstimate,
  AdminReadProjects,
] as const;

/** Providers comuns ao processo HTTP e ao worker. */
const sharedProviders = [
  { provide: PROJECT_ESTIMATOR, inject: [ENV], useFactory: createEstimator },
  {
    provide: PROJECTS_DEPS,
    inject: [ENV, DatabaseContext, ID_GENERATOR, CLOCK, AUDIT_LOGGER, MAILER, PROJECT_ESTIMATOR],
    useFactory: (
      env: Env,
      ctx: DatabaseContext,
      ids: IdGenerator,
      clock: Clock,
      audit: AuditLogger,
      mailer: Mailer,
      estimator: ProjectEstimator,
    ): ProjectsDeps => ({
      projects: new DrizzleProjectRepository(ctx, ids),
      queries: new DrizzleProjectQueries(ctx),
      attachments: new DrizzleAttachmentDirectory(ctx),
      catalog: new DrizzleProjectCatalog(ctx),
      people: new DrizzleProjectPeople(ctx),
      aiRuns: new DrizzleAiRunLog(ctx),
      estimator,
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
    inject: [PROJECTS_DEPS],
    useFactory: (deps: ProjectsDeps) => new UseCase(deps),
  })),
];

@Module({
  controllers: [ProjectsController, AdminProjectsController],
  providers: sharedProviders,
})
export class ProjectsModule {}

/** Worker: transforma eventos em pedidos de estimativa e executa a chamada à IA. */
@Module({
  imports: [BullModule.registerQueue({ name: QueueName.Estimation })],
  providers: [...sharedProviders, RequestEstimateOnProjectChange, EstimationProcessor],
})
export class ProjectsWorkerModule {}
