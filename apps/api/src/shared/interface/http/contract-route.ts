import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  HttpCode,
  RequestMapping,
  RequestMethod,
  SetMetadata,
} from '@nestjs/common';
import { type RouteContract, toRouterPath } from '@f4d/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequestValidationError } from './request-validation.error.js';

export const CONTRACT_ROUTE = Symbol('CONTRACT_ROUTE');

const METHODS: Record<RouteContract['method'], RequestMethod> = {
  get: RequestMethod.GET,
  post: RequestMethod.POST,
  put: RequestMethod.PUT,
  patch: RequestMethod.PATCH,
  delete: RequestMethod.DELETE,
};

/**
 * Liga um handler a uma rota declarada em `@f4d/contracts`: método, caminho e status de sucesso
 * vêm do contrato, de modo que API e OpenAPI não divergem.
 */
export const ContractRoute = (route: RouteContract) => {
  const successStatus = Object.keys(route.responses)
    .map(Number)
    .find((status) => status >= 200 && status < 300);
  return applyDecorators(
    SetMetadata(CONTRACT_ROUTE, route),
    RequestMapping({ path: toRouterPath(route.path), method: METHODS[route.method] }),
    HttpCode(successStatus ?? 200),
  );
};

/** Campo declarado no contrato → tipo validado; campo ausente → `undefined`. */
type Infer<T> = [Exclude<T, undefined>] extends [never]
  ? undefined
  : Exclude<T, undefined> extends z.ZodType
    ? z.output<Exclude<T, undefined>>
    : undefined;

export type ContractRequest<R extends RouteContract> = {
  params: Infer<R['request']['params']>;
  query: Infer<R['request']['query']>;
  body: Infer<R['request']['body']>;
};

const parsePart = (
  schema: z.ZodType | undefined,
  value: unknown,
  location: 'params' | 'query' | 'body',
  issues: { path: string; message: string }[],
): unknown => {
  if (!schema) return undefined;
  // Corpo ausente vira {}: o schema decide se os campos são obrigatórios (erro por campo).
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    issues.push({ path: [location, ...issue.path.map(String)].join('.'), message: issue.message });
  }
  return undefined;
};

/** Injeta `{ params, query, body }` já validados com os schemas do contrato da rota. */
export const ValidRequest = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const route = Reflect.getMetadata(CONTRACT_ROUTE, ctx.getHandler()) as RouteContract | undefined;
  if (!route) throw new Error('@ValidRequest() exige @ContractRoute() no mesmo handler.');

  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  const issues: { path: string; message: string }[] = [];
  const parsed = {
    params: parsePart(route.request.params, req.params, 'params', issues),
    query: parsePart(route.request.query, req.query, 'query', issues),
    body: parsePart(route.request.body, req.body, 'body', issues),
  };
  if (issues.length > 0) throw new RequestValidationError(issues);
  return parsed;
});
