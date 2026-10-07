import { z } from 'zod';

/** Paginação keyset: o cursor é opaco para o cliente (base64url do último registro). */
export const cursorQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export const cursorPage = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

export type CursorPage<T> = { items: T[]; nextCursor: string | null };
