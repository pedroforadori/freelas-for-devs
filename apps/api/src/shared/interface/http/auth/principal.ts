import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, Role } from '@f4d/contracts';
import type { FastifyRequest } from 'fastify';
import type { RequestMeta } from '../../../application/audit-log.js';

/** Quem está fazendo a requisição, extraído do access token verificado. */
export interface Principal {
  userId: string;
  roles: Role[];
  permissions: Permission[];
  sessionId: string;
  aal: 1 | 2;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

/** Marca handlers fora do registro de contratos como públicos (ex.: OpenAPI). Use com parcimônia. */
export const IS_PUBLIC = Symbol('IS_PUBLIC');
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Dispensa CSRF (somente webhooks de terceiros, que se autenticam por assinatura). */
export const SKIP_CSRF = Symbol('SKIP_CSRF');
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal => {
    const principal = ctx.switchToHttp().getRequest<FastifyRequest>().principal;
    if (!principal) throw new Error('@CurrentPrincipal() usado em rota sem autenticação.');
    return principal;
  },
);

export const requestMetaOf = (req: FastifyRequest): RequestMeta => ({
  ip: req.ip || null,
  userAgent: req.headers['user-agent'] ?? null,
  requestId: String(req.id),
});

export const RequestContext = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestMeta =>
    requestMetaOf(ctx.switchToHttp().getRequest<FastifyRequest>()),
);
