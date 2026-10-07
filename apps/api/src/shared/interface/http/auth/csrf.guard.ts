import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CLIENT_KIND_HEADER, ErrorCode, MOBILE_CLIENT } from '@f4d/contracts';
import type { FastifyRequest } from 'fastify';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.js';
import { ProblemError } from '../problem.error.js';
import { AUTH_COOKIES, type AuthCookies } from './auth-cookies.js';
import { SKIP_CSRF } from './principal.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteção CSRF para clientes com cookie (web): double-submit (header = cookie) + Origin permitida.
 *
 * Clientes nativos são dispensados apenas quando NÃO enviam cookies e se identificam por header
 * (Bearer ou `x-f4d-client: mobile`). Um site malicioso não consegue reproduzir isso: o browser
 * anexaria os cookies da vítima, e headers customizados disparam preflight CORS — que recusamos.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_COOKIES) private readonly cookies: AuthCookies,
    @Inject(ENV) private readonly env: Env,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()]))
      return true;

    const nativeClient =
      !req.headers.cookie &&
      (req.headers.authorization?.startsWith('Bearer ') === true ||
        req.headers[CLIENT_KIND_HEADER] === MOBILE_CLIENT);
    if (nativeClient) return true;

    const origin = req.headers.origin;
    if (origin && !this.env.CORS_ORIGINS.includes(origin)) {
      throw new ProblemError(403, ErrorCode.CsrfFailed, 'Origem não permitida.');
    }
    if (!this.cookies.csrfMatches(req)) {
      throw new ProblemError(
        403,
        ErrorCode.CsrfFailed,
        'Sessão de segurança expirada. Recarregue a página.',
      );
    }
    return true;
  }
}
