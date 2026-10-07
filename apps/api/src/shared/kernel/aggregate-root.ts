import type { PendingDomainEvent } from './domain-event.js';

/**
 * Raiz de agregado: fronteira de consistência transacional.
 * `version` sustenta o lock otimista; eventos são coletados e drenados pelo repositório,
 * que os grava no outbox (atribuindo o id) na mesma transação.
 */
export abstract class AggregateRoot<TId extends string = string> {
  protected abstract readonly aggregateType: string;
  private pendingEvents: PendingDomainEvent[] = [];

  protected constructor(
    readonly id: TId,
    private currentVersion: number,
  ) {}

  get version(): number {
    return this.currentVersion;
  }

  protected record(type: string, occurredAt: Date, payload: Record<string, unknown> = {}): void {
    this.pendingEvents.push({
      type,
      aggregateType: this.aggregateType,
      aggregateId: this.id,
      occurredAt,
      payload,
    });
  }

  /** Retorna e limpa os eventos pendentes; chamado pelo repositório ao persistir. */
  pullEvents(): PendingDomainEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  /** Chamado pelo repositório após gravar com sucesso. */
  markPersisted(): void {
    this.currentVersion += 1;
  }
}
