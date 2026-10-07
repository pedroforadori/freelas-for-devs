/**
 * Fato de negócio já ocorrido. É gravado no outbox na mesma transação do agregado
 * e publicado de forma assíncrona (ADR-0003).
 */
export interface DomainEvent<TType extends string = string, TPayload = Record<string, unknown>> {
  readonly id: string;
  readonly type: TType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

/** Evento registrado pelo agregado, ainda sem id (atribuído ao gravar no outbox). */
export type PendingDomainEvent = Omit<DomainEvent, 'id'>;

/** Gera identificadores. A implementação (UUIDv7) vive na infraestrutura. */
export interface IdGenerator {
  next(): string;
}
