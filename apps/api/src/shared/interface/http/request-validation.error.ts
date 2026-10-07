import type { FieldIssue } from '@f4d/contracts';

export class RequestValidationError extends Error {
  constructor(readonly issues: FieldIssue[]) {
    super('Requisição inválida.');
    this.name = 'RequestValidationError';
  }
}
