import { DomainError } from '../../../shared/kernel/domain-error.js';

/** Mensagem genérica de propósito: não revela se o e-mail existe nem qual campo errou. */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  constructor() {
    super('E-mail ou senha incorretos.');
  }
}

export class InvalidSessionError extends DomainError {
  readonly code = 'UNAUTHENTICATED';
  constructor(reason: 'not-found' | 'expired' | 'revoked' | 'reused' | 'user-inactive') {
    super('Sessão expirada. Entre novamente.', { reason });
  }
}

/**
 * Outra aba/requisição acabou de renovar esta sessão. Não é falha de segurança: o cliente
 * repete a requisição original (o cookie novo já está no browser) e a sessão segue válida.
 */
export class SessionSupersededError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('Sessão renovada em outra aba. Tente novamente.');
  }
}

export class AccountSuspendedError extends DomainError {
  readonly code = 'FORBIDDEN';
  constructor() {
    super('Conta suspensa. Entre em contato com o suporte.');
  }
}

export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('Já existe uma conta com este e-mail. Entre ou recupere sua senha.');
  }
}

export class InvalidOneTimeTokenError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Este link é inválido ou expirou. Solicite um novo.');
  }
}

export class WeakPasswordError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(reason: string) {
    super(reason);
  }
}

export class TooManyAttemptsError extends DomainError {
  readonly code = 'RATE_LIMITED';
  constructor(readonly retryAfterSeconds: number) {
    super('Muitas tentativas. Aguarde alguns minutos e tente novamente.', { retryAfterSeconds });
  }
}
