import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QueueName } from './queue-names.js';

const REPORT_INTERVAL_MS = 30_000;

/**
 * Sem listener, erros de conexão do Redis viram stack traces crus a cada tentativa de reconexão.
 * Aqui viram um log estruturado, no máximo um a cada 30 s por fila; o readiness indica a queda.
 */
@Injectable()
export class QueueErrorReporter implements OnModuleInit {
  private readonly logger = new Logger('Queue');
  private lastReportAt = 0;

  constructor(@InjectQueue(QueueName.DomainEvents) private readonly domainEvents: Queue) {}

  onModuleInit(): void {
    this.domainEvents.on('error', (error: Error) => {
      const now = Date.now();
      if (now - this.lastReportAt < REPORT_INTERVAL_MS) return;
      this.lastReportAt = now;
      this.logger.error({ queue: this.domainEvents.name, err: error.message }, 'Fila indisponível');
    });
  }
}
