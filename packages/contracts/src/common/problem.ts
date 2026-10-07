import { z } from 'zod';

/**
 * Códigos de erro estáveis. O cliente decide comportamento pelo `code`, nunca pela mensagem.
 * Novos códigos são adicionados aqui; nunca renomeie um código existente.
 */
export const ErrorCode = {
  ValidationFailed: 'VALIDATION_FAILED',
  Unauthenticated: 'UNAUTHENTICATED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  InvalidStateTransition: 'INVALID_STATE_TRANSITION',
  RateLimited: 'RATE_LIMITED',
  Internal: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const errorCodeSchema = z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]);

export const fieldIssueSchema = z.object({
  path: z.string().describe('Caminho do campo, ex.: "body.title"'),
  message: z.string(),
});

/** RFC 9457 — Problem Details for HTTP APIs. */
export const problemDetailsSchema = z
  .object({
    type: z.string().default('about:blank'),
    title: z.string(),
    status: z.number().int(),
    code: errorCodeSchema,
    detail: z.string().optional(),
    instance: z.string().optional(),
    requestId: z.string().optional(),
    errors: z.array(fieldIssueSchema).optional(),
  })
  .meta({ id: 'ProblemDetails' });

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
export type FieldIssue = z.infer<typeof fieldIssueSchema>;
