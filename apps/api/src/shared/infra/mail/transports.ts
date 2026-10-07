import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage } from '../../application/mailer.js';

/** Entrega efetiva de um e-mail. Usado só pelo worker; casos de uso falam com o `Mailer`. */
export interface MailTransport {
  deliver(message: EmailMessage): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Mascara o e-mail em logs: `an***@exemplo.com`. */
export const maskEmail = (email: string): string => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
};

/** Desenvolvimento/teste: só registra no log (sem corpo, que contém links com token). */
export class LogMailTransport implements MailTransport {
  private readonly logger = new Logger('Mail');

  deliver(message: EmailMessage): Promise<void> {
    this.logger.log(
      { to: maskEmail(message.to), tag: message.tag, subject: message.subject },
      'E-mail (log)',
    );
    return Promise.resolve();
  }
}

/** SMTP genérico. Em dev aponta para o Mailpit (http://localhost:8025). */
export class SmtpMailTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = createTransport(smtpUrl);
  }

  async deliver(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { 'X-F4D-Tag': message.tag },
    });
  }
}

/** Produção: API HTTP do Resend (sem SDK). Erros 4xx/5xx viram exceção → retentativa do BullMQ. */
export class ResendMailTransport implements MailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async deliver(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        tags: [{ name: 'category', value: message.tag.replace(/[^\w-]/g, '_') }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Resend respondeu ${response.status}`);
  }
}
