import { DomainError } from '../../../shared/kernel/domain-error.js';

export class FileNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Arquivo não encontrado.');
  }
}

export class FileNotReadyError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('O arquivo ainda está em verificação ou foi recusado.');
  }
}

export class UploadMissingError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Não encontramos o arquivo enviado. Tente enviar novamente.');
  }
}
