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
import { FilesFacade } from '../files/application/use-cases.js';
import { FilesModule, FilesWorkerModule } from '../files/files.module.js';
import { ProjectsFacade } from '../projects/application/facade.js';
import { ProjectsModule, ProjectsWorkerModule } from '../projects/projects.module.js';
import {
  AdvanceDisputes,
  ExecuteSettlement,
  ExpireUnpaidExtras,
  ManageDispute,
  ManageOutOfScope,
  ReadDisputes,
  RetryPendingSettlements,
} from './application/disputes.js';
import { ContractsFacade } from './application/facade.js';
import { CONTRACTS_DEPS, type ContractsDeps, type PaymentGateway } from './application/ports.js';
import {
  CancelContractForProject,
  ConfirmPayment,
  CreateContractForSelection,
  ExpireUnpaidContracts,
  HandlePaymentEvent,
  ManagePayoutAccount,
  ProcessReviewDeadlines,
  RateFreelancer,
  ReadContracts,
  ReconcilePendingPayments,
  ReleasePayment,
  RetryPendingReleases,
  ReviewDelivery,
  StartCheckout,
  SubmitDelivery,
} from './application/use-cases.js';
import {
  DrizzleContractPeople,
  DrizzleContractRepository,
  DrizzleLedger,
  DrizzlePaymentRepository,
  DrizzlePayoutAccounts,
  DrizzleRatings,
  DrizzleWebhookInbox,
} from './infrastructure/drizzle-contracts.js';
import {
  DrizzleDisputeQueries,
  DrizzleDisputeRepository,
  DrizzleOutOfScopeRepository,
} from './infrastructure/drizzle-disputes.js';
import { FakePaymentGateway } from './infrastructure/fake-gateway.js';
import { StripePaymentGateway } from './infrastructure/stripe-gateway.js';
import {
  AdminContractsController,
  ContractsController,
  DevPaymentsController,
  PaymentWebhookController,
} from './interface/contracts.controller.js';
import { AdminDisputesController, DisputesController } from './interface/disputes.controller.js';
import {
  ContractsEventHandler,
  ContractsSchedulesProcessor,
} from './interface/contracts.worker.js';

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

const createGateway = (env: Env): PaymentGateway =>
  env.PAYMENTS_PROVIDER === 'stripe'
    ? new StripePaymentGateway({
        secretKey: env.STRIPE_SECRET_KEY ?? '',
        webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
        paymentMethods: env.STRIPE_PAYMENT_METHODS,
        timeoutMs: 20_000,
      })
    : new FakePaymentGateway(env.WEB_APP_URL, env.FAKE_PAYMENTS_WEBHOOK_SECRET);

const SIMPLE_USE_CASES = [
  CreateContractForSelection,
  StartCheckout,
  ConfirmPayment,
  ExpireUnpaidContracts,
  CancelContractForProject,
  ManagePayoutAccount,
  ReadContracts,
  SubmitDelivery,
  ReviewDelivery,
  ProcessReviewDeadlines,
  ReleasePayment,
  RateFreelancer,
  ContractsFacade,
  ManageOutOfScope,
  ExpireUnpaidExtras,
  ManageDispute,
  AdvanceDisputes,
  ExecuteSettlement,
  ReadDisputes,
] as const;

const sharedProviders = [
  { provide: PAYMENT_GATEWAY, inject: [ENV], useFactory: createGateway },
  {
    provide: CONTRACTS_DEPS,
    inject: [
      ENV,
      DatabaseContext,
      ID_GENERATOR,
      CLOCK,
      AUDIT_LOGGER,
      MAILER,
      SETTINGS_READER,
      PAYMENT_GATEWAY,
      ProjectsFacade,
      FilesFacade,
    ],
    useFactory: (
      env: Env,
      ctx: DatabaseContext,
      ids: IdGenerator,
      clock: Clock,
      audit: AuditLogger,
      mailer: Mailer,
      settings: SettingsReader,
      gateway: PaymentGateway,
      projects: ProjectsFacade,
      files: FilesFacade,
    ): ContractsDeps => ({
      contracts: new DrizzleContractRepository(ctx, ids),
      payments: new DrizzlePaymentRepository(ctx),
      ledger: new DrizzleLedger(ctx, ids),
      inbox: new DrizzleWebhookInbox(ctx),
      payoutAccounts: new DrizzlePayoutAccounts(ctx),
      ratings: new DrizzleRatings(ctx),
      outOfScope: new DrizzleOutOfScopeRepository(ctx, ids),
      disputes: new DrizzleDisputeRepository(ctx, ids),
      disputeQueries: new DrizzleDisputeQueries(ctx),
      files,
      gateway,
      projects: {
        find: (projectId) => projects.find(projectId),
        startWork: (projectId) => projects.startWork(projectId),
        complete: (projectId) => projects.complete(projectId),
        closeByDispute: (projectId) => projects.closeByDispute(projectId),
      },
      people: new DrizzleContractPeople(ctx),
      settings,
      mailer,
      audit,
      uow: ctx,
      clock,
      ids,
      webAppUrl: env.WEB_APP_URL,
    }),
  },
  ...SIMPLE_USE_CASES.map((UseCase) => ({
    provide: UseCase,
    inject: [CONTRACTS_DEPS],
    useFactory: (deps: ContractsDeps) => new UseCase(deps),
  })),
  {
    provide: ReconcilePendingPayments,
    inject: [CONTRACTS_DEPS, ConfirmPayment],
    useFactory: (deps: ContractsDeps, confirm: ConfirmPayment) =>
      new ReconcilePendingPayments(deps, confirm),
  },
  {
    provide: RetryPendingSettlements,
    inject: [CONTRACTS_DEPS, ExecuteSettlement],
    useFactory: (deps: ContractsDeps, settle: ExecuteSettlement) =>
      new RetryPendingSettlements(deps, settle),
  },
  {
    provide: HandlePaymentEvent,
    inject: [CONTRACTS_DEPS, ConfirmPayment, ReleasePayment, RetryPendingSettlements],
    useFactory: (
      deps: ContractsDeps,
      confirm: ConfirmPayment,
      release: ReleasePayment,
      settlements: RetryPendingSettlements,
    ) => new HandlePaymentEvent(deps, confirm, release, settlements),
  },
  {
    provide: RetryPendingReleases,
    inject: [CONTRACTS_DEPS, ReleasePayment],
    useFactory: (deps: ContractsDeps, release: ReleasePayment) =>
      new RetryPendingReleases(deps, release),
  },
];

/** Contratos, pagamentos em custódia, razão contábil e contas de recebimento (F6). */
@Module({
  imports: [ProjectsModule, FilesModule],
  controllers: [
    ContractsController,
    PaymentWebhookController,
    DevPaymentsController,
    AdminContractsController,
    DisputesController,
    AdminDisputesController,
  ],
  providers: sharedProviders,
  exports: [ContractsFacade],
})
export class ContractsModule {}

@Module({
  imports: [
    ProjectsWorkerModule,
    FilesWorkerModule,
    BullModule.registerQueue({ name: QueueName.Contracts }),
  ],
  providers: [...sharedProviders, ContractsEventHandler, ContractsSchedulesProcessor],
})
export class ContractsWorkerModule {}
