import { InjectQueue, Processor } from '@nestjs/bullmq';
import { ReportingWorkerHost } from '../../../shared/infra/queue/reporting-worker-host.js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  type DomainEventHandler,
  HandlesDomainEvents,
} from '../../../shared/infra/queue/domain-events.processor.js';
import { QueueName } from '../../../shared/infra/queue/queue-names.js';
import type { DomainEvent } from '../../../shared/kernel/domain-event.js';
import { FailEstimate, GenerateEstimate } from '../application/use-cases.js';
import { ESTIMATION_TRIGGERS } from '../domain/project.js';

export interface EstimationJob {
  projectId: string;
  round: number;
}

/** Tentativas antes de desistir e passar o projeto ao especialista sem estimativa. */
export const ESTIMATION_ATTEMPTS = 3;

/**
 * Publicação ou respostas → pede uma estimativa. O jobId por (projeto, rodada) torna o
 * enfileiramento idempotente: o mesmo evento entregue duas vezes não gera duas chamadas à IA.
 */
@Injectable()
@HandlesDomainEvents(...ESTIMATION_TRIGGERS)
export class RequestEstimateOnProjectChange implements DomainEventHandler {
  constructor(@InjectQueue(QueueName.Estimation) private readonly queue: Queue<EstimationJob>) {}

  async handle(event: DomainEvent): Promise<void> {
    const round = Number(event.payload.round);
    await this.queue.add(
      'estimate',
      { projectId: event.aggregateId, round },
      {
        jobId: `estimate:${event.aggregateId}:${round}`,
        attempts: ESTIMATION_ATTEMPTS,
        backoff: { type: 'exponential', delay: 10_000 },
      },
    );
  }
}

/** Chama o estimador. Na última tentativa falha, o projeto segue para o especialista. */
@Processor(QueueName.Estimation, { concurrency: 3 })
export class EstimationProcessor extends ReportingWorkerHost {
  private readonly logger = new Logger('Estimation');

  constructor(
    @Inject(GenerateEstimate) private readonly generate: GenerateEstimate,
    @Inject(FailEstimate) private readonly fail: FailEstimate,
  ) {
    super();
  }

  async process(job: Job<EstimationJob>): Promise<string> {
    const { projectId, round } = job.data;
    try {
      return await this.generate.execute(projectId, round);
    } catch (error) {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.warn(
        { projectId, round, attempt: job.attemptsMade + 1, lastAttempt, err: String(error) },
        'Falha ao estimar projeto',
      );
      if (!lastAttempt) throw error;
      await this.fail.execute(projectId, round);
      return 'failed';
    }
  }
}
