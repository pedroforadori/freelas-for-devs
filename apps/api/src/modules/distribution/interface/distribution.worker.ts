import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  type DomainEventHandler,
  HandlesDomainEvents,
} from '../../../shared/infra/queue/domain-events.processor.js';
import { QueueName } from '../../../shared/infra/queue/queue-names.js';
import { ReportingWorkerHost } from '../../../shared/infra/queue/reporting-worker-host.js';
import type { DomainEvent } from '../../../shared/kernel/domain-event.js';
import {
  CancelProjectRound,
  ExpireOverdueInvitations,
  FinalizeHiring,
  OpenRound,
  RemoveSuspendedFreelancer,
  RevertSelection,
  SyncQueueEntry,
} from '../application/use-cases.js';

/** Eventos de outros módulos que movem a fila (todos idempotentes). */
export const DistributionEventTypes = {
  ProfileApproved: 'profiles.FreelancerProfileApproved',
  LevelChanged: 'profiles.FreelancerLevelChanged',
  ScopeApproved: 'projects.ScopeApproved',
  ProjectCancelled: 'projects.ProjectCancelled',
  ContractFunded: 'contracts.ContractFunded',
  ContractExpired: 'contracts.ContractExpired',
  UserSuspended: 'identity.UserSuspended',
} as const;

@Injectable()
@HandlesDomainEvents(...Object.values(DistributionEventTypes))
export class DistributionEventHandler implements DomainEventHandler {
  constructor(
    @Inject(SyncQueueEntry) private readonly sync: SyncQueueEntry,
    @Inject(OpenRound) private readonly openRound: OpenRound,
    @Inject(CancelProjectRound) private readonly cancelRound: CancelProjectRound,
    @Inject(FinalizeHiring) private readonly finalize: FinalizeHiring,
    @Inject(RevertSelection) private readonly revert: RevertSelection,
    @Inject(RemoveSuspendedFreelancer) private readonly removeSuspended: RemoveSuspendedFreelancer,
  ) {}

  async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload;
    switch (event.type) {
      case DistributionEventTypes.ProfileApproved:
        await this.sync.execute(String(payload.userId), String(payload.level));
        break;
      case DistributionEventTypes.LevelChanged:
        await this.sync.execute(String(payload.userId), String(payload.to));
        break;
      case DistributionEventTypes.ScopeApproved:
        await this.openRound.execute(String(payload.projectId));
        break;
      case DistributionEventTypes.ProjectCancelled:
        await this.cancelRound.execute(String(payload.projectId));
        break;
      case DistributionEventTypes.ContractFunded:
        await this.finalize.execute(String(payload.projectId));
        break;
      case DistributionEventTypes.ContractExpired:
        await this.revert.execute(String(payload.projectId));
        break;
      case DistributionEventTypes.UserSuspended:
        await this.removeSuspended.execute(String(payload.userId));
        break;
    }
  }
}

const RECONCILE_EVERY_MS = 60_000;

/**
 * Reconciliador de prazos: a cada minuto expira convites vencidos e repõe as vagas. O BullMQ
 * garante uma execução por intervalo entre as réplicas do worker (job scheduler).
 */
@Processor(QueueName.Distribution, { concurrency: 1 })
export class DistributionDeadlinesProcessor
  extends ReportingWorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger('DistributionDeadlines');

  constructor(
    @Inject(ExpireOverdueInvitations) private readonly expire: ExpireOverdueInvitations,
    @InjectQueue(QueueName.Distribution) private readonly queue: Queue,
  ) {
    super();
  }

  /**
   * Agenda sem bloquear o boot: com o Redis fora, o BullMQ espera a reconexão indefinidamente,
   * e o processo precisa subir mesmo assim (health, logs, relay do outbox).
   */
  onApplicationBootstrap(): void {
    void this.queue
      .upsertJobScheduler(
        'expire-invitations',
        { every: RECONCILE_EVERY_MS },
        { name: 'expire-invitations' },
      )
      .catch((error: unknown) =>
        this.logger.error({ err: String(error) }, 'Não foi possível agendar o reconciliador'),
      );
  }

  async process(): Promise<number> {
    const expired = await this.expire.execute();
    if (expired > 0) this.logger.log({ expired }, 'Convites expirados');
    return expired;
  }
}
