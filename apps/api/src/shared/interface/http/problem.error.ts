import type { ErrorCode } from '@f4d/contracts';

/** Erro da camada HTTP (guards, controllers) com status e código estável já definidos. */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'ProblemError';
  }
}
