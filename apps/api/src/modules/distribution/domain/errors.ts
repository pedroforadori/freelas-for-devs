import { DomainError } from '../../../shared/kernel/domain-error.js';

export class InvitationNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Convite não encontrado.');
  }
}

export class ProposalOutOfScopeError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(message: string) {
    super(message);
  }
}

export class RoundNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Este projeto não está recebendo propostas.');
  }
}
