import { getQueueToken } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { QueueName } from './queue-names.js';

const REPORT_INTERVAL_MS = 30_000;

/**
 * Sem listener, erros de conexão do Redis viram stack traces crus a cada tentativa de reconexão.
 * Aqui viram um log estruturado, no máximo um a cada 30 s por fila; o readiness indica a queda.
 * Cobre toda fila registrada no processo (HTTP e worker registram conjuntos diferentes).
 */
@Injectable()
export class QueueErrorReporter implements OnApplicationBootstrap {
  private readonly logger = new Logger('Queue');

  constructor(private readonly moduleRef: ModuleRef) {}

  onApplicationBootstrap(): void {
    for (const name of Object.values(QueueName)) {
      const queue = this.find(name);
      if (!queue?.on) continue;
      let lastReportAt = 0;
      queue.on('error', (error: Error) => {
        const now = Date.now();
        if (now - lastReportAt < REPORT_INTERVAL_MS) return;
        lastReportAt = now;
        this.logger.error({ queue: name, err: error.message }, 'Fila indisponível');
      });
    }
  }

  private find(name: string): Queue | null {
    try {
      return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
    } catch {
      return null;
    }
  }
}
