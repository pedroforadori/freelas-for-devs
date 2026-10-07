import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface CookieSettings {
  secure: boolean;
  /** Domínio pai, só para o cookie CSRF (precisa ser lido pelo JS do web). */
  csrfDomain: string | undefined;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export interface SessionCookies {
  accessToken: string;
  refreshToken: string;
}

/**
 * Cookies de sessão (docs/architecture.md §7):
 * - access: `__Host-`, httpOnly, SameSite=Lax, vale para toda a API.
 * - refresh: `__Secure-`, httpOnly, SameSite=Strict, restrito a /v1/auth (não trafega nas demais rotas).
 * - csrf: legível por JS no domínio pai (double-submit); não é segredo de sessão.
 * Em dev sem HTTPS, os prefixos são omitidos (exigem Secure).
 */
export class AuthCookies {
  readonly access: string;
  readonly refresh: string;
  readonly csrf = 'f4d_csrf';

  constructor(private readonly settings: CookieSettings) {
    this.access = settings.secure ? '__Host-f4d_at' : 'f4d_at';
    this.refresh = settings.secure ? '__Secure-f4d_rt' : 'f4d_rt';
  }

  setSession(reply: FastifyReply, session: SessionCookies): void {
    const { secure, accessTtlSeconds, refreshTtlSeconds } = this.settings;
    void reply.setCookie(this.access, session.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: accessTtlSeconds,
    });
    void reply.setCookie(this.refresh, session.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/v1/auth',
      maxAge: refreshTtlSeconds,
    });
  }

  clearSession(reply: FastifyReply): void {
    const { secure } = this.settings;
    void reply.clearCookie(this.access, { path: '/', secure, httpOnly: true, sameSite: 'lax' });
    void reply.clearCookie(this.refresh, {
      path: '/v1/auth',
      secure,
      httpOnly: true,
      sameSite: 'strict',
    });
  }

  /** Emite um token CSRF novo (rotacionado a cada login/logout). */
  issueCsrf(reply: FastifyReply): string {
    const token = randomBytes(32).toString('base64url');
    void reply.setCookie(this.csrf, token, {
      httpOnly: false,
      secure: this.settings.secure,
      sameSite: 'lax',
      path: '/',
      ...(this.settings.csrfDomain ? { domain: this.settings.csrfDomain } : {}),
    });
    return token;
  }

  readAccess(req: FastifyRequest): string | undefined {
    return req.cookies[this.access];
  }

  readRefresh(req: FastifyRequest): string | undefined {
    return req.cookies[this.refresh];
  }

  hasSessionCookie(req: FastifyRequest): boolean {
    return Boolean(req.cookies[this.access] ?? req.cookies[this.refresh]);
  }

  /** Comparação em tempo constante entre o header e o cookie CSRF. */
  csrfMatches(req: FastifyRequest): boolean {
    const cookie = req.cookies[this.csrf];
    const header = req.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || cookie.length !== header.length) return false;
    return timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
  }
}

export const AUTH_COOKIES = Symbol('AUTH_COOKIES');
