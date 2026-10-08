import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

const REPORT_INTERVAL_MS = 30_000;

/**
 * Base dos consumers BullMQ. Sem listener de `error`, cada tentativa de reconexão ao Redis vira
 * um stack trace cru no log; aqui vira um log estruturado, no máximo um a cada 30 s por consumer.
 */
export abstract class ReportingWorkerHost extends WorkerHost {
  private readonly queueLogger = new Logger('Queue');
  private lastReportAt = 0;

  @OnWorkerEvent('error')
  onWorkerError(error: Error): void {
    const now = Date.now();
    if (now - this.lastReportAt < REPORT_INTERVAL_MS) return;
    this.lastReportAt = now;
    this.queueLogger.error(
      { consumer: this.constructor.name, err: error.message },
      'Consumer sem conexão com a fila',
    );
  }
}
