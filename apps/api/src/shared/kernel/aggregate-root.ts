import type { DomainEvent } from './domain-event.js';

/**
 * Raiz de agregado: fronteira de consistência transacional.
 * `version` sustenta o lock otimista; eventos são coletados e drenados pelo repositório.
 */
export abstract class AggregateRoot<TId extends string = string> {
  private pendingEvents: DomainEvent[] = [];

  protected constructor(
    readonly id: TId,
    private currentVersion: number,
  ) {}

  get version(): number {
    return this.currentVersion;
  }

  protected record(event: DomainEvent): void {
    this.pendingEvents.push(event);
  }

  /** Retorna e limpa os eventos pendentes; chamado pelo repositório ao persistir. */
  pullEvents(): DomainEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  /** Chamado pelo repositório após gravar com sucesso. */
  markPersisted(): void {
    this.currentVersion += 1;
  }
}
