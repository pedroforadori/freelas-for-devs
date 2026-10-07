export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Categoria para métricas e supressão (ex.: `auth.verify-email`). */
  tag: string;
}

/**
 * Port de envio de e-mail. A implementação de produção enfileira (BullMQ) e o worker entrega,
 * com retentativas — o caso de uso não espera o provedor responder.
 */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export const MAILER = Symbol('MAILER');
