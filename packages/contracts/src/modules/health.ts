import { z } from 'zod';
import { defineRoute } from '../http/route.js';

export const dependencyStatusSchema = z.enum(['up', 'down']);

export const livenessResponseSchema = z
  .object({
    status: z.literal('ok'),
    version: z.string(),
    uptimeSeconds: z.number().nonnegative(),
  })
  .meta({ id: 'Liveness' });

export const readinessResponseSchema = z
  .object({
    status: z.enum(['ready', 'degraded']),
    checks: z.record(z.string(), dependencyStatusSchema),
  })
  .meta({ id: 'Readiness' });

export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const healthRoutes = {
  liveness: defineRoute({
    method: 'get',
    path: '/v1/health',
    operationId: 'getLiveness',
    summary: 'Processo vivo (não verifica dependências).',
    tags: ['health'],
    auth: 'public',
    request: {},
    responses: { 200: livenessResponseSchema },
  }),
  readiness: defineRoute({
    method: 'get',
    path: '/v1/health/ready',
    operationId: 'getReadiness',
    summary: 'Pronto para tráfego: verifica Postgres e Redis.',
    tags: ['health'],
    auth: 'public',
    request: {},
    responses: { 200: readinessResponseSchema, 503: readinessResponseSchema },
  }),
} as const;
