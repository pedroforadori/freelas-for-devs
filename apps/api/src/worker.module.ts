import { Module } from '@nestjs/common';
import { infrastructureModules } from './app.module.js';
import { OutboxRelayModule } from './shared/infra/outbox/outbox.module.js';

/**
 * Processo de background: relay do outbox e, a partir da F2, os consumers BullMQ de cada módulo
 * e o cron reconciliador de prazos. Escala independentemente do processo HTTP.
 */
@Module({
  imports: [...infrastructureModules, OutboxRelayModule],
})
export class WorkerModule {}
