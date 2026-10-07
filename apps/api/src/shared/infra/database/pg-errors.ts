/** Erros do Postgres relevantes para a aplicação (códigos SQLSTATE). */
const UNIQUE_VIOLATION = '23505';

interface PgErrorLike {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

/** O Drizzle embrulha o erro do driver em `cause`; procura em toda a cadeia. */
const findPgError = (error: unknown): PgErrorLike | undefined => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as PgErrorLike;
    if (typeof candidate.code === 'string' && candidate.code.length === 5) return candidate;
    current = candidate.cause;
  }
  return undefined;
};

export const isUniqueViolation = (error: unknown, constraint?: string): boolean => {
  const pgError = findPgError(error);
  if (pgError?.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || pgError.constraint === constraint;
};
