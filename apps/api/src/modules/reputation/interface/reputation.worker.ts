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
import { RecomputeReputation } from '../application/use-cases.js';

/** Contratos que mudam a reputação: recalcula o freelancer na hora, sem esperar a noite. */
export const ReputationEventTypes = {
  ContractReleased: 'contracts.ContractReleased',
  ContractSettled: 'contracts.ContractSettled',
  ContractAbandoned: 'contracts.ContractAbandoned',
} as const;

@Injectable()
@HandlesDomainEvents(...Object.values(ReputationEventTypes))
export class ReputationEventHandler implements DomainEventHandler {
  constructor(@Inject(RecomputeReputation) private readonly recompute: RecomputeReputation) {}

  async handle(event: DomainEvent): Promise<void> {
    await this.recompute.execute([String(event.payload.freelancerId)]);
  }
}

/** Recálculo noturno (03:00 de Brasília): estatísticas, scores e progressão de nível. */
@Processor(QueueName.Reputation, { concurrency: 1 })
export class ReputationNightlyProcessor
  extends ReportingWorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger('ReputationNightly');

  constructor(
    @Inject(RecomputeReputation) private readonly recompute: RecomputeReputation,
    @InjectQueue(QueueName.Reputation) private readonly queue: Queue,
  ) {
    super();
  }

  /** Sem bloquear o boot (Redis fora não pode impedir o processo de subir). */
  onApplicationBootstrap(): void {
    void this.queue
      .upsertJobScheduler(
        'nightly-reputation',
        { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' },
        { name: 'nightly-reputation' },
      )
      .catch((error: unknown) =>
        this.logger.error({ err: String(error) }, 'Agendamento da reputação falhou'),
      );
  }

  async process(): Promise<unknown> {
    const result = await this.recompute.execute();
    this.logger.log(result, 'Reputação recalculada');
    return result;
  }
}
