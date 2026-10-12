import { timingSafeEqual } from 'node:crypto';
import { Controller, Inject, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { apiRoutes, ErrorCode, type OAuthProviderName, OAuthErrorReason } from '@f4d/contracts';
import { generateCodeVerifier, generateState } from 'arctic';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { SECRET_CIPHER, type SecretCipher } from '../../../shared/application/secret-cipher.js';
import { ENV } from '../../../shared/config/config.module.js';
import type { Env } from '../../../shared/config/env.js';
import {
  AUTH_COOKIES,
  type AuthCookies,
} from '../../../shared/interface/http/auth/auth-cookies.js';
import { RequestContext } from '../../../shared/interface/http/auth/principal.js';
import {
  type ContractRequest,
  ContractRoute,
  ValidRequest,
} from '../../../shared/interface/http/contract-route.js';
import { ProblemError } from '../../../shared/interface/http/problem.error.js';
import { SignInWithOAuth } from '../application/oauth-use-cases.js';
import {
  AccountSuspendedError,
  BetaClosedError,
  OAuthEmailNotVerifiedError,
} from '../domain/errors.js';
import { OAUTH_PROVIDERS, type OAuthProviderRegistry } from '../infrastructure/oauth-providers.js';

const routes = apiRoutes.auth;
const STATE_TTL_SECONDS = 600;

const pendingSchema = z.object({
  state: z.string(),
  codeVerifier: z.string(),
  provider: z.enum(['github', 'google']),
  role: z.enum(['CLIENT', 'FREELANCER']).optional(),
  redirectTo: z.string(),
  expiresAt: z.number(),
});
type PendingOAuth = z.infer<typeof pendingSchema>;

const sameString = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Login social em navegação de página (não fetch): a API responde com redirecionamentos.
 * `state` (anti-CSRF) e o `code_verifier` (PKCE) vão num cookie cifrado e autenticado de
 * 10 minutos, restrito a /v1/auth/oauth — sem estado no servidor.
 */
@Controller()
export class OAuthController {
  private readonly cookieName: string;

  constructor(
    private readonly signInWithOAuth: SignInWithOAuth,
    @Inject(OAUTH_PROVIDERS) private readonly providers: OAuthProviderRegistry,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(AUTH_COOKIES) private readonly cookies: AuthCookies,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.cookieName = env.COOKIE_SECURE ? '__Secure-f4d_oauth' : 'f4d_oauth';
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ContractRoute(routes.oauthStart)
  start(
    @ValidRequest() { params, query }: ContractRequest<typeof routes.oauthStart>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): void {
    const provider = this.provider(params.provider);
    const pending: PendingOAuth = {
      state: generateState(),
      codeVerifier: generateCodeVerifier(),
      provider: params.provider,
      ...(query.role ? { role: query.role } : {}),
      redirectTo: query.redirectTo ?? '/',
      expiresAt: Date.now() + STATE_TTL_SECONDS * 1000,
    };
    void reply.setCookie(this.cookieName, this.cipher.encrypt(JSON.stringify(pending)), {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      // Lax: o cookie precisa voltar no redirecionamento (GET de nível superior) vindo do provedor.
      sameSite: 'lax',
      path: '/v1/auth/oauth',
      maxAge: STATE_TTL_SECONDS,
    });
    void reply.redirect(
      provider.authorizationUrl(pending.state, pending.codeVerifier).toString(),
      302,
    );
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ContractRoute(routes.oauthCallback)
  async callback(
    @ValidRequest() { params, query }: ContractRequest<typeof routes.oauthCallback>,
    @RequestContext() meta: RequestMeta,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const pending = this.readPending(req);
    void reply.clearCookie(this.cookieName, { path: '/v1/auth/oauth' });

    if (query.error) return this.fail(reply, OAuthErrorReason.Cancelled);
    if (
      !pending ||
      !query.code ||
      !query.state ||
      pending.provider !== params.provider ||
      pending.expiresAt < Date.now() ||
      !sameString(pending.state, query.state)
    ) {
      return this.fail(reply, OAuthErrorReason.InvalidState);
    }

    let profile;
    try {
      profile = await this.provider(params.provider).fetchProfile(query.code, pending.codeVerifier);
    } catch {
      return this.fail(reply, OAuthErrorReason.ProviderFailed);
    }

    let outcome;
    try {
      outcome = await this.signInWithOAuth.execute(profile, { role: pending.role }, meta);
    } catch (error) {
      if (error instanceof OAuthEmailNotVerifiedError)
        return this.fail(reply, OAuthErrorReason.EmailNotVerified);
      if (error instanceof AccountSuspendedError)
        return this.fail(reply, OAuthErrorReason.AccountSuspended);
      if (error instanceof BetaClosedError) return this.fail(reply, OAuthErrorReason.BetaClosed);
      throw error;
    }

    if (outcome.kind === 'mfa_required') {
      // No fragmento (#): não vai para logs de servidor nem para o cabeçalho Referer.
      void reply.redirect(
        `${this.env.WEB_APP_URL}/entrar/verificacao#desafio=${encodeURIComponent(outcome.challengeToken)}`,
        302,
      );
      return;
    }
    this.cookies.setSession(reply, outcome.session);
    this.cookies.issueCsrf(reply);
    void reply.redirect(`${this.env.WEB_APP_URL}${pending.redirectTo}`, 302);
  }

  private provider(name: OAuthProviderName) {
    const provider = this.providers.get(name);
    if (!provider)
      throw new ProblemError(404, ErrorCode.NotFound, 'Provedor de login indisponível.');
    return provider;
  }

  private readPending(req: FastifyRequest): PendingOAuth | null {
    const raw = req.cookies[this.cookieName];
    if (!raw) return null;
    try {
      return pendingSchema.parse(JSON.parse(this.cipher.decrypt(raw)));
    } catch {
      return null;
    }
  }

  private fail(reply: FastifyReply, reason: string): void {
    void reply.redirect(`${this.env.WEB_APP_URL}/entrar?erro=${reason}`, 302);
  }
}
