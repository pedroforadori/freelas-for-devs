import { DomainError } from '../../../shared/kernel/domain-error.js';

export class ProjectNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Projeto não encontrado.');
  }
}

export class InvalidClarificationAnswersError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(reason: string) {
    super(reason);
  }
}

export class InvalidAttachmentsError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Um ou mais anexos não existem, não são seus ou foram recusados na verificação.');
  }
}

export class ProjectLimitError extends DomainError {
  readonly code = 'RATE_LIMITED';
  constructor(message: string, retryAfterSeconds?: number) {
    super(message, retryAfterSeconds ? { retryAfterSeconds } : {});
  }
}

export class ScopeRuleError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(message: string) {
    super(message);
  }
}

export class StaleScopeVersionError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(currentVersion: number) {
    super(
      `O escopo foi alterado (versão atual: ${currentVersion}). Revise a versão mais recente antes de aprovar.`,
      { currentVersion },
    );
  }
}
