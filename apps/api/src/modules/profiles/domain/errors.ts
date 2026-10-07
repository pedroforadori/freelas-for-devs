import { DomainError } from '../../../shared/kernel/domain-error.js';

export class ProfileNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Perfil não encontrado.');
  }
}

export class PortfolioLimitError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(limit: number) {
    super(`O portfólio comporta até ${limit} itens.`, { limit });
  }
}

export class PortfolioItemNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Item de portfólio não encontrado.');
  }
}

export class UnknownCatalogEntryError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(kind: 'stack' | 'nível', values: string[]) {
    super(
      `${kind === 'stack' ? 'Stacks desconhecidas' : 'Nível desconhecido'}: ${values.join(', ')}.`,
      {
        kind,
        values,
      },
    );
  }
}

export class SameLevelError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('O freelancer já está neste nível.');
  }
}
