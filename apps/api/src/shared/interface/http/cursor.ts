import type { z } from 'zod';

/**
 * Cursores de paginação keyset: opacos para o cliente (base64url de JSON), validados na volta.
 * Um cursor adulterado é tratado como ausente (primeira página), nunca como erro 500.
 */
export const encodeCursor = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

export const decodeCursor = <T extends z.ZodType>(
  cursor: string | undefined,
  schema: T,
): z.output<T> | null => {
  if (!cursor) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
