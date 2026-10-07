/**
 * Erro de regra de negócio. O `code` é mapeado para o código HTTP/Problem Details
 * na camada de interface; o domínio não conhece HTTP.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidStateTransitionError extends DomainError {
  readonly code = 'INVALID_STATE_TRANSITION';

  constructor(machine: string, from: string, event: string, reason?: string) {
    super(
      `${machine}: transição "${event}" não permitida a partir de "${from}"${reason ? ` (${reason})` : ''}.`,
      { machine, from, event, ...(reason ? { reason } : {}) },
    );
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';

  constructor(entity: string, id: string) {
    super(`${entity} ${id} não encontrado.`, { entity, id });
  }
}

export class ConcurrencyError extends DomainError {
  readonly code = 'CONFLICT';

  constructor(entity: string, id: string) {
    super(`${entity} ${id} foi alterado por outra operação; tente novamente.`, { entity, id });
  }
}
