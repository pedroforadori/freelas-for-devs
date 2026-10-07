import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import type { EmailMessage, Mailer } from '../../application/mailer.js';
import { MAILER } from '../../application/mailer.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { QueueName } from '../queue/queue-names.js';
import {
  LogMailTransport,
  MAIL_TRANSPORT,
  type MailTransport,
  ResendMailTransport,
  SmtpMailTransport,
} from './transports.js';

/** Enfileira o e-mail; o worker entrega com até 8 tentativas e backoff exponencial. */
@Injectable()
export class QueuedMailer implements Mailer {
  constructor(@InjectQueue(QueueName.Mail) private readonly queue: Queue<EmailMessage>) {}

  async send(message: EmailMessage): Promise<void> {
    await this.queue.add(message.tag, message, {
      attempts: 8,
      backoff: { type: 'exponential', delay: 10_000 },
      // Mensagens contêm links com token: não manter o payload após a entrega.
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    });
  }
}

@Processor(QueueName.Mail, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport) {
    super();
  }

  async process(job: Job<EmailMessage>): Promise<void> {
    await this.transport.deliver(job.data);
  }
}

const createTransportFor = (env: Env): MailTransport => {
  switch (env.MAIL_TRANSPORT) {
    case 'smtp':
      return new SmtpMailTransport(env.SMTP_URL ?? 'smtp://localhost:1025', env.MAIL_FROM);
    case 'resend':
      if (!env.RESEND_API_KEY)
        throw new Error('RESEND_API_KEY é obrigatório com MAIL_TRANSPORT=resend.');
      return new ResendMailTransport(env.RESEND_API_KEY, env.MAIL_FROM);
    case 'log':
      return new LogMailTransport();
  }
};

/** Disponível no processo HTTP: só enfileira. */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QueueName.Mail })],
  providers: [{ provide: MAILER, useClass: QueuedMailer }],
  exports: [MAILER],
})
export class MailModule {}

/** Disponível no worker: entrega de fato. */
@Module({
  imports: [BullModule.registerQueue({ name: QueueName.Mail })],
  providers: [
    { provide: MAIL_TRANSPORT, inject: [ENV], useFactory: createTransportFor },
    MailProcessor,
  ],
})
export class MailWorkerModule {}
