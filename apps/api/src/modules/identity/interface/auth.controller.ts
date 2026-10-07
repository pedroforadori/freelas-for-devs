import { Controller, Inject, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  apiRoutes,
  type AuthResponse,
  CLIENT_KIND_HEADER,
  type LoginResponse,
  type Me,
  type MfaEnableResponse,
  type MfaSetupResponse,
  MOBILE_CLIENT,
} from '@f4d/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import {
  AUTH_COOKIES,
  type AuthCookies,
} from '../../../shared/interface/http/auth/auth-cookies.js';
import {
  CurrentPrincipal,
  type Principal,
  RequestContext,
} from '../../../shared/interface/http/auth/principal.js';
import {
  type ContractRequest,
  ContractRoute,
  ValidRequest,
} from '../../../shared/interface/http/contract-route.js';
import {
  type AuthResult,
  GetCurrentUser,
  LoginWithPassword,
  Logout,
  RefreshSession,
  RegisterUser,
  RequestPasswordReset,
  ResendEmailVerification,
  ResetPassword,
  VerifyEmail,
} from '../application/use-cases.js';
import {
  BeginMfaSetup,
  CompleteMfaLogin,
  ConfirmMfaSetup,
  DisableMfa,
} from '../application/mfa-use-cases.js';
import { InvalidSessionError } from '../domain/errors.js';
import type { User } from '../domain/user.js';

const routes = apiRoutes.auth;
const MINUTE = 60_000;

export const toMe = (user: User, session: { mfaEnabled: boolean; sessionAal: 1 | 2 }): Me => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  emailVerified: user.isEmailVerified,
  roles: [...user.roles],
  permissions: user.permissions,
  mfaEnabled: session.mfaEnabled,
  sessionAal: session.sessionAal,
  createdAt: user.createdAt.toISOString(),
});

const isMobile = (req: FastifyRequest) => req.headers[CLIENT_KIND_HEADER] === MOBILE_CLIENT;

/**
 * Limites por IP mais duros que o global nas rotas de autenticação. O bloqueio por conta
 * (força bruta distribuída) fica no caso de uso de login.
 */
@Controller()
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUser,
    private readonly loginWithPassword: LoginWithPassword,
    private readonly refreshSession: RefreshSession,
    private readonly logoutUseCase: Logout,
    private readonly verifyEmailUseCase: VerifyEmail,
    private readonly resendVerification: ResendEmailVerification,
    private readonly requestPasswordReset: RequestPasswordReset,
    private readonly resetPasswordUseCase: ResetPassword,
    private readonly getCurrentUser: GetCurrentUser,
    private readonly beginMfaSetup: BeginMfaSetup,
    private readonly confirmMfaSetup: ConfirmMfaSetup,
    private readonly completeMfaLogin: CompleteMfaLogin,
    private readonly disableMfa: DisableMfa,
    @Inject(AUTH_COOKIES) private readonly cookies: AuthCookies,
  ) {}

  @ContractRoute(routes.csrf)
  csrf(@Res({ passthrough: true }) reply: FastifyReply): void {
    this.cookies.issueCsrf(reply);
  }

  @Throttle({ default: { limit: 5, ttl: 10 * MINUTE } })
  @ContractRoute(routes.register)
  async register(
    @ValidRequest() { body }: ContractRequest<typeof routes.register>,
    @RequestContext() meta: RequestMeta,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    const { acceptTerms: _acceptTerms, ...input } = body;
    return this.respond(req, reply, await this.registerUser.execute(input, meta));
  }

  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ContractRoute(routes.login)
  async login(
    @ValidRequest() { body }: ContractRequest<typeof routes.login>,
    @RequestContext() meta: RequestMeta,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const outcome = await this.loginWithPassword.execute(body, meta);
    if (outcome.kind === 'mfa_required') {
      // Nenhum cookie de sessão ainda: só o desafio, que expira em minutos.
      return {
        status: 'mfa_required',
        challengeToken: outcome.challengeToken,
        expiresInSeconds: outcome.expiresInSeconds,
      };
    }
    return this.respond(req, reply, outcome);
  }

  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  @ContractRoute(routes.refresh)
  async refresh(
    @ValidRequest() { body }: ContractRequest<typeof routes.refresh>,
    @RequestContext() meta: RequestMeta,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    const token = body.refreshToken ?? this.cookies.readRefresh(req);
    try {
      return this.respond(req, reply, await this.refreshSession.execute(token, meta));
    } catch (error) {
      // Sessão inválida: limpa cookies para o web não ficar em loop de refresh. Se outra aba
      // apenas renovou antes (409), os cookies novos são válidos e precisam ser preservados.
      if (error instanceof InvalidSessionError && !isMobile(req)) this.cookies.clearSession(reply);
      throw error;
    }
  }

  @ContractRoute(routes.logout)
  async logout(
    @ValidRequest() { body }: ContractRequest<typeof routes.logout>,
    @RequestContext() meta: RequestMeta,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.logoutUseCase.execute(body.refreshToken ?? this.cookies.readRefresh(req), meta);
    this.cookies.clearSession(reply);
    this.cookies.issueCsrf(reply);
  }

  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ContractRoute(routes.verifyEmail)
  async verifyEmail(
    @ValidRequest() { body }: ContractRequest<typeof routes.verifyEmail>,
    @RequestContext() meta: RequestMeta,
  ): Promise<void> {
    await this.verifyEmailUseCase.execute(body.token, meta);
  }

  @Throttle({ default: { limit: 3, ttl: 15 * MINUTE } })
  @ContractRoute(routes.resendVerification)
  async resend(@CurrentPrincipal() principal: Principal): Promise<void> {
    await this.resendVerification.execute(principal.userId);
  }

  @Throttle({ default: { limit: 3, ttl: 15 * MINUTE } })
  @ContractRoute(routes.forgotPassword)
  async forgotPassword(
    @ValidRequest() { body }: ContractRequest<typeof routes.forgotPassword>,
    @RequestContext() meta: RequestMeta,
  ): Promise<void> {
    await this.requestPasswordReset.execute(body.email, meta);
  }

  @Throttle({ default: { limit: 5, ttl: 15 * MINUTE } })
  @ContractRoute(routes.resetPassword)
  async resetPassword(
    @ValidRequest() { body }: ContractRequest<typeof routes.resetPassword>,
    @RequestContext() meta: RequestMeta,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.resetPasswordUseCase.execute(body, meta);
    this.cookies.clearSession(reply);
  }

  @ContractRoute(routes.me)
  async me(@CurrentPrincipal() principal: Principal): Promise<Me> {
    const { user, mfaEnabled } = await this.getCurrentUser.execute(principal.userId);
    return toMe(user, { mfaEnabled, sessionAal: principal.aal });
  }

  @Throttle({ default: { limit: 5, ttl: 15 * MINUTE } })
  @ContractRoute(routes.mfaSetup)
  async mfaSetup(@CurrentPrincipal() principal: Principal): Promise<MfaSetupResponse> {
    return this.beginMfaSetup.execute(principal.userId);
  }

  @Throttle({ default: { limit: 10, ttl: 15 * MINUTE } })
  @ContractRoute(routes.mfaEnable)
  async mfaEnable(
    @ValidRequest() { body }: ContractRequest<typeof routes.mfaEnable>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MfaEnableResponse> {
    const result = await this.confirmMfaSetup.execute(principal, body.code, meta);
    return { ...this.respond(req, reply, result), recoveryCodes: result.recoveryCodes };
  }

  @Throttle({ default: { limit: 10, ttl: MINUTE } })
  @ContractRoute(routes.mfaVerify)
  async mfaVerify(
    @ValidRequest() { body }: ContractRequest<typeof routes.mfaVerify>,
    @RequestContext() meta: RequestMeta,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    return this.respond(req, reply, await this.completeMfaLogin.execute(body, meta));
  }

  @Throttle({ default: { limit: 5, ttl: 15 * MINUTE } })
  @ContractRoute(routes.mfaDisable)
  async mfaDisable(
    @ValidRequest() { body }: ContractRequest<typeof routes.mfaDisable>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<void> {
    await this.disableMfa.execute(principal, body.code, meta);
  }

  /** Web: tokens só em cookies httpOnly (+ CSRF rotacionado). Mobile: tokens no corpo. */
  private respond(req: FastifyRequest, reply: FastifyReply, result: AuthResult): AuthResponse {
    const user = toMe(result.user, {
      mfaEnabled: result.mfaEnabled,
      sessionAal: result.session.aal,
    });
    const { accessToken, refreshToken, accessTokenExpiresIn } = result.session;
    if (isMobile(req)) {
      return {
        status: 'authenticated',
        user,
        session: { accessToken, refreshToken, accessTokenExpiresIn },
      };
    }
    this.cookies.setSession(reply, { accessToken, refreshToken });
    this.cookies.issueCsrf(reply);
    return { status: 'authenticated', user };
  }
}
