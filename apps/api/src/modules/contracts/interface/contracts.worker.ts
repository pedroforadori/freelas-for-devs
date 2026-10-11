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
} as const;

/** Escolha da proposta → contrato; projeto cancelado → contrato encerrado (idempotentes). */
@Injectable()
@HandlesDomainEvents(...Object.values(ContractsEventTypes))
export class ContractsEventHandler implements DomainEventHandler {
  constructor(
    @Inject(CreateContractForSelection) private readonly create: CreateContractForSelection,
    @Inject(CancelContractForProject) private readonly cancel: CancelContractForProject,
    @Inject(ReleasePayment) private readonly release: ReleasePayment,
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
    }
  }
}

const SCHEDULES = [
  { name: 'expire-unpaid-contracts', every: 60_000 },
  { name: 'review-deadlines', every: 60_000 },
  { name: 'reconcile-payments', every: 5 * 60_000 },
  { name: 'retry-releases', every: 15 * 60_000 },
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
    const result = await this.reconcile.execute();
    if (result.confirmed + result.closed > 0) this.logger.warn(result, 'Pagamentos reconciliados');
    return result;
  }
}
