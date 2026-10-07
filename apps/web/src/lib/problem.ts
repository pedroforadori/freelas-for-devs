import { ApiError } from '@f4d/api-client';
import type { ProblemDetails } from '@f4d/contracts';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

export const problemOf = (error: unknown): ProblemDetails | null =>
  error instanceof ApiError ? error.problem : null;

export const errorMessage = (error: unknown): string =>
  problemOf(error)?.detail ?? 'Algo deu errado. Verifique sua conexão e tente novamente.';

/**
 * Distribui os erros por campo devolvidos pela API (`body.email`) nos campos do formulário.
 * Retorna true se algum erro foi atribuído a um campo.
 */
export const applyFieldErrors = <T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): boolean => {
  const issues = problemOf(error)?.errors ?? [];
  for (const issue of issues) {
    setError(issue.path.replace(/^body\./, '') as Path<T>, {
      type: 'server',
      message: issue.message,
    });
  }
  return issues.length > 0;
};
