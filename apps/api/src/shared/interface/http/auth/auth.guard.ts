import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ErrorCode,
  MFA_REQUIRED_PERMISSIONS,
  permissionsFor,
  type Role,
  type RouteContract,
} from '@f4d/contracts';
import type { FastifyRequest } from 'fastify';
import { CONTRACT_ROUTE } from '../contract-route.js';
import { ProblemError } from '../problem.error.js';
import { AUTH_COOKIES, type AuthCookies } from './auth-cookies.js';
import { IS_PUBLIC } from './principal.js';

export interface VerifiedAccessToken {
  userId: string;
  roles: Role[];
  sessionId: string;
  aal: 1 | 2;
}

/** Verifica access tokens; implementado pelo módulo de identidade. */
export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedAccessToken>;
}

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

const bearerToken = (req: FastifyRequest): string | undefined => {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
};

/**
 * Autenticação + RBAC a partir do contrato da rota. Nega por padrão: um handler sem
 * `@ContractRoute` nem `@Public()` não é acessível (evita rota esquecida sem proteção).
 * Regras de posse do recurso ficam nas políticas dos casos de uso.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    @Inject(AUTH_COOKIES) private readonly cookies: AuthCookies,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const route = this.reflector.get<RouteContract | undefined>(CONTRACT_ROUTE, ctx.getHandler());
    if (!route) {
      if (
        this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])
      ) {
        return true;
      }
      throw new ProblemError(403, ErrorCode.Forbidden, 'Rota sem requisito de acesso declarado.');
    }
    if (route.auth === 'public') return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const token = bearerToken(req) ?? this.cookies.readAccess(req);
    if (!token) throw new ProblemError(401, ErrorCode.Unauthenticated, 'Entre para continuar.');

    let verified: VerifiedAccessToken;
    try {
      verified = await this.verifier.verify(token);
    } catch {
      throw new ProblemError(401, ErrorCode.Unauthenticated, 'Sessão expirada. Entre novamente.');
    }

    req.principal = { ...verified, permissions: permissionsFor(verified.roles) };
    if (route.auth === 'authenticated') return true;

    const { permission } = route.auth;
    if (!req.principal.permissions.includes(permission)) {
      throw new ProblemError(403, ErrorCode.Forbidden, 'Você não tem permissão para esta ação.');
    }
    if (MFA_REQUIRED_PERMISSIONS.has(permission) && verified.aal < 2) {
      throw new ProblemError(
        403,
        ErrorCode.MfaRequired,
        'Confirme com o segundo fator para continuar.',
      );
    }
    return true;
  }
}
