import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  type DomainEventHandler,
  HandlesDomainEvents,
} from '../../../shared/infra/queue/domain-events.processor.js';
import { QueueName } from '../../../shared/infra/queue/queue-names.js';
import { ReportingWorkerHost } from '../../../shared/infra/queue/reporting-worker-host.js';
import type { DomainEvent } from '../../../shared/kernel/domain-event.js';
import {
  AdvanceDisputes,
  ExecuteSettlement,
  ExpireUnpaidExtras,
  RetryPendingSettlements,
} from '../application/disputes.js';
import {
  CancelContractForProject,
  CreateContractForSelection,
  ExpireUnpaidContracts,
  ProcessReviewDeadlines,
  ReconcilePendingPayments,
  ReleasePayment,
  RetryPendingReleases,
} from '../application/use-cases.js';

export const ContractsEventTypes = {
  ProposalSelected: 'distribution.ProposalSelected',
  ProjectCancelled: 'projects.ProjectCancelled',
  ContractApproved: 'contracts.ContractApproved',
  DisputeResolved: 'contracts.DisputeResolved',
} as const;

/**
 * Escolha da proposta → contrato; projeto cancelado → contrato encerrado; aprovação → repasse;
 * disputa decidida → reembolso e repasse (todos idempotentes).
 */
@Injectable()
@HandlesDomainEvents(...Object.values(ContractsEventTypes))
export class ContractsEventHandler implements DomainEventHandler {
  constructor(
    @Inject(CreateContractForSelection) private readonly create: CreateContractForSelection,
    @Inject(CancelContractForProject) private readonly cancel: CancelContractForProject,
    @Inject(ReleasePayment) private readonly release: ReleasePayment,
    @Inject(ExecuteSettlement) private readonly settle: ExecuteSettlement,
  ) {}

  async handle(event: DomainEvent): Promise<void> {
    const p = event.payload;
    if (event.type === ContractsEventTypes.ProposalSelected) {
      await this.create.execute({
        projectId: String(p.projectId),
        invitationId: String(p.invitationId),
        clientId: String(p.clientId),
        freelancerId: String(p.freelancerId),
        amountCents: Number(p.amountCents),
        deadlineDays: Number(p.deadlineDays),
      });
    } else if (event.type === ContractsEventTypes.ProjectCancelled) {
      await this.cancel.execute(String(p.projectId));
    } else if (event.type === ContractsEventTypes.ContractApproved) {
      await this.release.execute(String(p.contractId));
    } else if (event.type === ContractsEventTypes.DisputeResolved) {
      await this.settle.execute(String(p.disputeId));
    }
  }
}

const SCHEDULES = [
  { name: 'expire-unpaid-contracts', every: 60_000 },
  { name: 'review-deadlines', every: 60_000 },
  { name: 'reconcile-payments', every: 5 * 60_000 },
  { name: 'retry-releases', every: 15 * 60_000 },
  { name: 'expire-unpaid-extras', every: 60_000 },
  { name: 'advance-disputes', every: 60_000 },
  { name: 'retry-settlements', every: 15 * 60_000 },
] as const;

/** Prazos de pagamento e reconciliação com o provedor (job schedulers do BullMQ). */
@Processor(QueueName.Contracts, { concurrency: 1 })
export class ContractsSchedulesProcessor
  extends ReportingWorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger('ContractsSchedules');

  constructor(
    @Inject(ExpireUnpaidContracts) private readonly expire: ExpireUnpaidContracts,
    @Inject(ReconcilePendingPayments) private readonly reconcile: ReconcilePendingPayments,
    @Inject(ProcessReviewDeadlines) private readonly reviews: ProcessReviewDeadlines,
    @Inject(RetryPendingReleases) private readonly releases: RetryPendingReleases,
    @Inject(ExpireUnpaidExtras) private readonly extras: ExpireUnpaidExtras,
    @Inject(AdvanceDisputes) private readonly disputes: AdvanceDisputes,
    @Inject(RetryPendingSettlements) private readonly settlements: RetryPendingSettlements,
    @InjectQueue(QueueName.Contracts) private readonly queue: Queue,
  ) {
    super();
  }

  /** Sem bloquear o boot (Redis fora não pode impedir o processo de subir). */
  onApplicationBootstrap(): void {
    for (const schedule of SCHEDULES) {
      void this.queue
        .upsertJobScheduler(schedule.name, { every: schedule.every }, { name: schedule.name })
        .catch((error: unknown) =>
          this.logger.error({ err: String(error), schedule: schedule.name }, 'Agendamento falhou'),
        );
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'expire-unpaid-contracts') {
      const expired = await this.expire.execute();
      if (expired > 0) this.logger.log({ expired }, 'Contratos expirados por falta de pagamento');
      return expired;
    }
    if (job.name === 'review-deadlines') {
      const processed = await this.reviews.execute();
      if (processed > 0) this.logger.log({ processed }, 'Revisões vencidas processadas');
      return processed;
    }
    if (job.name === 'retry-releases') {
      const released = await this.releases.execute();
      if (released > 0) this.logger.log({ released }, 'Repasses pendentes liberados');
      return released;
    }
    if (job.name === 'expire-unpaid-extras') {
      const expired = await this.extras.execute();
      if (expired > 0) this.logger.log({ expired }, 'Adicionais fora de escopo não pagos');
      return expired;
    }
    if (job.name === 'advance-disputes') {
      const advanced = await this.disputes.execute();
      if (advanced > 0) this.logger.log({ advanced }, 'Disputas enviadas para análise');
      return advanced;
    }
    if (job.name === 'retry-settlements') {
      const closed = await this.settlements.execute();
      if (closed > 0) this.logger.log({ closed }, 'Decisões de disputa executadas');
      return closed;
    }
    const result = await this.reconcile.execute();
    if (result.confirmed + result.closed > 0) this.logger.warn(result, 'Pagamentos reconciliados');
    return result;
  }
}
