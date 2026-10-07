import { z } from 'zod';
import type { Permission } from '../auth/permissions.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Requisito de acesso de uma rota:
 * - `public`: sem sessão (ex.: login, health).
 * - `authenticated`: qualquer usuário logado (ex.: /me).
 * - `{ permission }`: RBAC; permissões administrativas também exigem 2FA (MFA_REQUIRED_PERMISSIONS).
 */
export type RouteAuth = 'public' | 'authenticated' | { readonly permission: Permission };

/** Resposta sem corpo (HTTP 204/202). */
export const noContent = z.undefined().meta({ description: 'Sem conteúdo' });

/**
 * Declaração de uma rota HTTP. A API valida request com estes schemas, o OpenAPI é gerado
 * a partir deles e o api-client herda os tipos — uma única fonte de verdade.
 */
export interface RouteContract<
  TParams extends z.ZodObject | undefined = z.ZodObject | undefined,
  TQuery extends z.ZodObject | undefined = z.ZodObject | undefined,
  TBody extends z.ZodType | undefined = z.ZodType | undefined,
  TResponses extends Record<number, z.ZodType> = Record<number, z.ZodType>,
> {
  method: HttpMethod;
  /** Caminho no formato OpenAPI, ex.: `/v1/projects/{projectId}`. */
  path: `/${string}`;
  operationId: string;
  summary: string;
  tags: readonly string[];
  auth: RouteAuth;
  request: {
    params?: TParams;
    query?: TQuery;
    body?: TBody;
  };
  responses: TResponses;
}

export const defineRoute = <
  TParams extends z.ZodObject | undefined = undefined,
  TQuery extends z.ZodObject | undefined = undefined,
  TBody extends z.ZodType | undefined = undefined,
  TResponses extends Record<number, z.ZodType> = Record<number, z.ZodType>,
>(
  route: RouteContract<TParams, TQuery, TBody, TResponses>,
) => route;

/** Caminho no formato do roteador do Nest/Fastify (`{id}` → `:id`). */
export const toRouterPath = (path: string): string => path.replace(/\{(\w+)\}/g, ':$1');
