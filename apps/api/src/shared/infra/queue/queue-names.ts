/** Filas BullMQ. Cada módulo de domínio que consome eventos registra seus processors nelas. */
export const QueueName = {
  DomainEvents: 'domain-events',
  Mail: 'mail',
  Files: 'files',
  Estimation: 'estimation',
  Distribution: 'distribution',
  Contracts: 'contracts',
  Reputation: 'reputation',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];
