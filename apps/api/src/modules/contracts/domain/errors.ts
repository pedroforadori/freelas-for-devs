import { DomainError } from '../../../shared/kernel/domain-error.js';

export class ContractNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Contrato não encontrado.');
  }
}

export class PaymentWindowClosedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('O prazo de pagamento deste contrato terminou.');
  }
}

export class InvalidWebhookError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Assinatura do webhook inválida.');
  }
}
