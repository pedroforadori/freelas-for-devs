import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QueueName } from '../../../shared/infra/queue/queue-names.js';
import { ReportingWorkerHost } from '../../../shared/infra/queue/reporting-worker-host.js';
import { PurgeExpiredData } from '../application/use-cases.js';

/** Retenção diária (04:00 de Brasília): apaga o que passou do prazo (LGPD: minimização). */
@Processor(QueueName.Privacy, { concurrency: 1 })
export class RetentionProcessor extends ReportingWorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger('Retention');

  constructor(
    @Inject(PurgeExpiredData) private readonly purge: PurgeExpiredData,
    @InjectQueue(QueueName.Privacy) private readonly queue: Queue,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    void this.queue
      .upsertJobScheduler(
        'daily-retention',
        { pattern: '0 4 * * *', tz: 'America/Sao_Paulo' },
        { name: 'daily-retention' },
      )
      .catch((error: unknown) =>
        this.logger.error({ err: String(error) }, 'Agendamento da retenção falhou'),
      );
  }

  async process(): Promise<unknown> {
    const result = await this.purge.execute();
    this.logger.log(result, 'Retenção aplicada');
    return result;
  }
}
