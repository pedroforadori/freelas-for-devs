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

export class BetaClosedError extends DomainError {
  readonly code = 'FORBIDDEN';
  constructor() {
    super(
      'A plataforma está em beta fechado: só e-mails convidados podem criar conta. Entre na lista de espera para receber seu convite.',
    );
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

export class InvalidMfaCodeError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Código inválido ou já utilizado. Confira o app autenticador e tente de novo.');
  }
}

export class MfaAlreadyEnabledError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('A verificação em duas etapas já está ativa.');
  }
}

export class MfaNotEnabledError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('A verificação em duas etapas não está ativa.');
  }
}

/** Ação sensível que exige sessão confirmada com segundo fator. */
export class StepUpRequiredError extends DomainError {
  readonly code = 'MFA_REQUIRED';
  constructor() {
    super('Confirme com o segundo fator para continuar.');
  }
}

export class MfaMandatoryError extends DomainError {
  readonly code = 'FORBIDDEN';
  constructor() {
    super('A verificação em duas etapas é obrigatória para administradores.');
  }
}

export class OAuthEmailNotVerifiedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super(
      'Seu e-mail não está verificado neste provedor. Verifique-o lá ou cadastre-se com e-mail e senha.',
    );
  }
}
