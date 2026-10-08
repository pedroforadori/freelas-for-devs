import { Module } from '@nestjs/common';
import { infrastructureModules } from './app.module.js';
import { FilesWorkerModule } from './modules/files/files.module.js';
import { ProjectsWorkerModule } from './modules/projects/projects.module.js';
import { MailModule, MailWorkerModule } from './shared/infra/mail/mail.module.js';
import { OutboxRelayModule } from './shared/infra/outbox/outbox.module.js';
import { DomainEventsWorkerModule } from './shared/infra/queue/domain-events.processor.js';

/**
 * Processo de background: relay do outbox, roteamento dos eventos de domínio e os consumers BullMQ
 * de cada módulo. Escala independentemente do processo HTTP.
 */
@Module({
  imports: [
    ...infrastructureModules,
    OutboxRelayModule,
    DomainEventsWorkerModule,
    // Casos de uso do worker também enviam e-mails (enfileirados e entregues pelo MailWorker).
    MailModule,
    MailWorkerModule,
    FilesWorkerModule,
    ProjectsWorkerModule,
  ],
})
export class WorkerModule {}
