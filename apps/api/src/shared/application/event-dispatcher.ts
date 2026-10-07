import type { DomainEvent } from '../kernel/domain-event.js';

/** Entrega um evento já confirmado no banco aos consumidores assíncronos. Deve ser idempotente por `event.id`. */
export interface EventDispatcher {
  dispatch(event: DomainEvent): Promise<void>;
}

export const EVENT_DISPATCHER = Symbol('EVENT_DISPATCHER');
