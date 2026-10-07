import { Global, Logger, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AUDIT_LOGGER, type AuditLogger } from '../../shared/application/audit-log.js';
import { MAILER, type Mailer } from '../../shared/application/mailer.js';
import { SECRET_CIPHER, type SecretCipher } from '../../shared/application/secret-cipher.js';
import { ENV } from '../../shared/config/config.module.js';
import type { Env } from '../../shared/config/env.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import { ID_GENERATOR } from '../../shared/infra/id/uuid-v7.generator.js';
import { REDIS } from '../../shared/infra/queue/queue.module.js';
import { AUTH_COOKIES, AuthCookies } from '../../shared/interface/http/auth/auth-cookies.js';
import { ACCESS_TOKEN_VERIFIER } from '../../shared/interface/http/auth/auth.guard.js';
import type { Clock } from '../../shared/kernel/clock.js';
import { DAY_MS, HOUR_MS } from '../../shared/kernel/clock.js';
import type { IdGenerator } from '../../shared/kernel/domain-event.js';
import { ProvisionAdmin } from './application/admin-use-cases.js';
import { SignInWithOAuth } from './application/oauth-use-cases.js';
import type { OAuthProvider } from './application/ports.js';
import { IDENTITY_DEPS, type IdentityDeps } from './application/deps.js';
import {
  BeginMfaSetup,
  CompleteMfaLogin,
  ConfirmMfaSetup,
  DisableMfa,
} from './application/mfa-use-cases.js';
import {
  GetCurrentUser,
  LoginWithPassword,
  Logout,
  RefreshSession,
  RegisterUser,
  RequestPasswordReset,
  ResendEmailVerification,
  ResetPassword,
  VerifyEmail,
} from './application/use-cases.js';
import {
  generateEphemeralKeys,
  JoseAccessTokenService,
  loadSigningKeys,
  type SigningKeys,
} from './infrastructure/access-tokens.js';
import { Argon2PasswordHasher, Sha256SecretTokenGenerator } from './infrastructure/crypto.js';
import {
  DrizzleOneTimeTokenRepository,
  DrizzleRefreshTokenRepository,
  DrizzleUserRepository,
} from './infrastructure/drizzle-identity.repositories.js';
import { DrizzleAuthIdentityRepository } from './infrastructure/drizzle-auth-identity.repository.js';
import { DrizzleMfaRepository } from './infrastructure/drizzle-mfa.repository.js';
import {
  GitHubOAuthProvider,
  GoogleOAuthProvider,
  OAUTH_PROVIDERS,
  type OAuthProviderRegistry,
} from './infrastructure/oauth-providers.js';
import { RedisLoginAttemptLimiter } from './infrastructure/redis-login-attempt-limiter.js';
import { OtpAuthTotpService } from './infrastructure/totp.js';
import { AuthController } from './interface/auth.controller.js';
import { OAuthController } from './interface/oauth.controller.js';

const signingKeys = (env: Env): SigningKeys => {
  if (env.JWT_PRIVATE_KEY) {
    return loadSigningKeys({
      privateKeyPem: env.JWT_PRIVATE_KEY,
      keyId: env.JWT_KEY_ID,
      previousPublicKeys: env.JWT_PREVIOUS_PUBLIC_KEYS,
    });
  }
  // O schema de env impede chegar aqui em produção.
  new Logger('Identity').warn(
    'JWT_PRIVATE_KEY ausente: usando chave efêmera (sessões caem a cada restart).',
  );
  return generateEphemeralKeys();
};

/** Habilita só os provedores com credenciais configuradas. */
const oauthProviders = (env: Env): OAuthProviderRegistry => {
  const callback = (name: string) => `${env.API_PUBLIC_URL}/v1/auth/oauth/${name}/callback`;
  const providers: OAuthProvider[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.push(
      new GitHubOAuthProvider(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, callback('github')),
    );
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      new GoogleOAuthProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, callback('google')),
    );
  }
  return new Map(providers.map((provider) => [provider.name, provider]));
};

const USE_CASES = [
  RegisterUser,
  LoginWithPassword,
  RefreshSession,
  Logout,
  VerifyEmail,
  ResendEmailVerification,
  RequestPasswordReset,
  ResetPassword,
  GetCurrentUser,
  BeginMfaSetup,
  ConfirmMfaSetup,
  CompleteMfaLogin,
  DisableMfa,
  ProvisionAdmin,
  SignInWithOAuth,
] as const;

/**
 * Global porque os guards de autenticação (registrados no AppModule) dependem do verificador
 * de tokens e dos cookies de sessão.
 */
@Global()
@Module({
  controllers: [AuthController, OAuthController],
  providers: [
    {
      provide: JoseAccessTokenService,
      inject: [ENV],
      useFactory: (env: Env) =>
        new JoseAccessTokenService(signingKeys(env), env.ACCESS_TOKEN_TTL_SECONDS),
    },
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: JoseAccessTokenService },
    { provide: OAUTH_PROVIDERS, inject: [ENV], useFactory: oauthProviders },
    {
      provide: AUTH_COOKIES,
      inject: [ENV],
      useFactory: (env: Env) =>
        new AuthCookies({
          secure: env.COOKIE_SECURE,
          csrfDomain: env.COOKIE_DOMAIN,
          accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
          refreshTtlSeconds: env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600,
        }),
    },
    {
      provide: IDENTITY_DEPS,
      inject: [
        ENV,
        DatabaseContext,
        ID_GENERATOR,
        CLOCK,
        AUDIT_LOGGER,
        MAILER,
        REDIS,
        JoseAccessTokenService,
        SECRET_CIPHER,
      ],
      useFactory: (
        env: Env,
        ctx: DatabaseContext,
        ids: IdGenerator,
        clock: Clock,
        audit: AuditLogger,
        mailer: Mailer,
        redis: Redis,
        accessTokens: JoseAccessTokenService,
        cipher: SecretCipher,
      ): IdentityDeps => ({
        users: new DrizzleUserRepository(ctx, ids),
        refreshTokens: new DrizzleRefreshTokenRepository(ctx),
        oneTimeTokens: new DrizzleOneTimeTokenRepository(ctx),
        mfa: new DrizzleMfaRepository(ctx),
        authIdentities: new DrizzleAuthIdentityRepository(ctx),
        totp: new OtpAuthTotpService(),
        cipher,
        hasher: new Argon2PasswordHasher(),
        accessTokens,
        secrets: new Sha256SecretTokenGenerator(),
        loginLimiter: new RedisLoginAttemptLimiter(redis),
        mailer,
        audit,
        uow: ctx,
        clock,
        ids,
        settings: {
          refreshTokenTtlMs: env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
          emailVerificationTtlMs: 24 * HOUR_MS,
          passwordResetTtlMs: HOUR_MS,
          mfaChallengeTtlMs: 5 * 60_000,
          webAppUrl: env.WEB_APP_URL,
        },
      }),
    },
    ...USE_CASES.map((UseCase) => ({
      provide: UseCase,
      inject: [IDENTITY_DEPS],
      useFactory: (deps: IdentityDeps) => new UseCase(deps),
    })),
  ],
  exports: [ACCESS_TOKEN_VERIFIER, AUTH_COOKIES],
})
export class IdentityModule {}
