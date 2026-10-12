import type { SelfAssignableRole } from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { HOUR_MS } from '../../../shared/kernel/clock.js';
import {
  AccountSuspendedError,
  BetaClosedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidOneTimeTokenError,
  InvalidSessionError,
  SessionSupersededError,
  TooManyAttemptsError,
} from '../domain/errors.js';
import { checkPassword } from '../domain/password-policy.js';
import { decideRotation } from '../domain/refresh-rotation.js';
import { User } from '../domain/user.js';
import type { IdentityDeps } from './deps.js';
import { passwordResetEmail, verificationEmail } from './emails.js';
import type { OneTimeTokenPurpose } from './ports.js';
import { type IssuedSession, SessionIssuer } from './session-issuer.js';

export interface AuthResult {
  user: User;
  session: IssuedSession;
  mfaEnabled: boolean;
}

/** Senha correta, mas a conta exige o segundo fator: a sessão só sai após o código. */
export interface MfaChallenge {
  challengeToken: string;
  expiresInSeconds: number;
}

export type LoginOutcome =
  ({ kind: 'authenticated' } & AuthResult) | ({ kind: 'mfa_required' } & MfaChallenge);

/** Base comum: acesso às deps, emissão de sessão e tokens de uso único. */
export abstract class IdentityUseCase {
  protected readonly sessions: SessionIssuer;

  constructor(protected readonly deps: IdentityDeps) {
    this.sessions = new SessionIssuer(deps);
  }

  protected async createOneTimeToken(userId: string, purpose: OneTimeTokenPurpose, ttlMs: number) {
    const { secrets, oneTimeTokens, ids, clock } = this.deps;
    const now = clock.now();
    await oneTimeTokens.invalidateAll(userId, purpose, now);
    const { token, hash } = secrets.generate();
    await oneTimeTokens.insert({
      id: ids.next(),
      userId,
      purpose,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + ttlMs),
    });
    return token;
  }

  /**
   * Credencial primária já validada (senha ou provedor externo): abre a sessão — ou, se a conta
   * tem 2FA, devolve um desafio de curta duração e nenhuma sessão.
   */
  protected async signIn(
    user: User,
    meta: RequestMeta,
    auditMetadata: Record<string, unknown>,
  ): Promise<LoginOutcome> {
    const { mfa, uow, audit, settings } = this.deps;
    if ((await mfa.find(user.id))?.enabledAt) {
      const challengeToken = await uow.run(() =>
        this.createOneTimeToken(user.id, 'MFA_CHALLENGE', settings.mfaChallengeTtlMs),
      );
      return {
        kind: 'mfa_required',
        challengeToken,
        expiresInSeconds: Math.round(settings.mfaChallengeTtlMs / 1000),
      };
    }

    const session = await uow.run(async () => {
      const issued = await this.sessions.start(user, meta);
      await audit.record({
        actorId: user.id,
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        metadata: auditMetadata,
        request: meta,
      });
      return issued;
    });
    return { kind: 'authenticated', user, session, mfaEnabled: false };
  }

  protected async sendVerificationEmail(user: User, token: string): Promise<void> {
    const { settings, mailer } = this.deps;
    const url = `${settings.webAppUrl}/verificar-email?token=${token}`;
    const hours = Math.round(settings.emailVerificationTtlMs / HOUR_MS);
    // Falha no enfileiramento não desfaz o cadastro: o usuário pode pedir reenvio.
    await mailer
      .send(verificationEmail(user.email, user.displayName, url, hours))
      .catch(() => undefined);
  }
}

export class RegisterUser extends IdentityUseCase {
  async execute(
    input: { email: string; password: string; displayName: string; role: SelfAssignableRole },
    meta: RequestMeta,
  ): Promise<AuthResult> {
    const { users, hasher, uow, clock, ids, audit, settings } = this.deps;
    const policy = checkPassword(input.password, input);
    if (!policy.ok) throw policy.error;
    if (!(await this.deps.signupGate.allows(input.email))) throw new BetaClosedError();

    // Hash fora da transação: argon2 é deliberadamente lento.
    const passwordHash = await hasher.hash(input.password);

    const { user, session, verificationToken } = await uow.run(async () => {
      if (await users.findByEmail(input.email)) throw new EmailAlreadyRegisteredError();
      const created = User.register({
        id: ids.next(),
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        role: input.role,
        now: clock.now(),
      });
      await users.save(created);
      const token = await this.createOneTimeToken(
        created.id,
        'EMAIL_VERIFICATION',
        settings.emailVerificationTtlMs,
      );
      const issued = await this.sessions.start(created, meta);
      await audit.record({
        actorId: created.id,
        action: 'auth.register',
        targetType: 'user',
        targetId: created.id,
        metadata: { role: input.role },
        request: meta,
      });
      return { user: created, session: issued, verificationToken: token };
    });

    await this.sendVerificationEmail(user, verificationToken);
    return { user, session, mfaEnabled: false };
  }
}

export class LoginWithPassword extends IdentityUseCase {
  async execute(
    input: { email: string; password: string },
    meta: RequestMeta,
  ): Promise<LoginOutcome> {
    const { users, hasher, loginLimiter, audit } = this.deps;
    const limiterKey = `login:${input.email}`;

    const lockedFor = await loginLimiter.lockedFor(limiterKey);
    if (lockedFor > 0) throw new TooManyAttemptsError(lockedFor);

    const user = await users.findByEmail(input.email);
    const valid = user?.passwordHash
      ? await hasher.verify(user.passwordHash, input.password)
      : await hasher.verifyDummy(input.password).then(() => false);

    if (!user || !valid) {
      await loginLimiter.registerFailure(limiterKey);
      await audit.record({
        actorId: null,
        action: 'auth.login_failed',
        targetType: 'user',
        targetId: user?.id ?? null,
        metadata: { reason: user ? 'wrong-password' : 'unknown-email' },
        request: meta,
      });
      throw new InvalidCredentialsError();
    }
    if (!user.isActive) throw new AccountSuspendedError();

    await loginLimiter.reset(limiterKey);
    return this.signIn(user, meta, { method: 'password' });
  }
}

export class RefreshSession extends IdentityUseCase {
  async execute(refreshToken: string | undefined, meta: RequestMeta): Promise<AuthResult> {
    const { secrets, refreshTokens, users, clock, uow, audit } = this.deps;
    if (!refreshToken) throw new InvalidSessionError('not-found');

    const record = await refreshTokens.findByHash(secrets.hash(refreshToken));
    if (!record) throw new InvalidSessionError('not-found');

    const now = clock.now();
    const decision = decideRotation(record, now);
    switch (decision.kind) {
      case 'reuse-detected':
        await refreshTokens.revokeFamily(record.familyId, now);
        await audit.record({
          actorId: record.userId,
          action: 'auth.refresh_reuse_detected',
          targetType: 'session',
          targetId: record.familyId,
          request: meta,
        });
        throw new InvalidSessionError('reused');
      case 'superseded':
        throw new SessionSupersededError();
      case 'revoked':
        throw new InvalidSessionError('revoked');
      case 'expired':
        throw new InvalidSessionError('expired');
      case 'rotate':
        break;
    }

    return uow.run(async () => {
      // Condicional no banco: entre duas requisições simultâneas, só uma rotaciona.
      if (!(await refreshTokens.markRotated(record.id, now))) throw new SessionSupersededError();
      const user = await users.findById(record.userId);
      if (!user?.isActive) {
        await refreshTokens.revokeFamily(record.familyId, now);
        throw new InvalidSessionError('user-inactive');
      }
      const session = await this.sessions.start(user, meta, {
        familyId: record.familyId,
        aal: record.aal,
      });
      return { user, session, mfaEnabled: Boolean((await this.deps.mfa.find(user.id))?.enabledAt) };
    });
  }
}

export class Logout extends IdentityUseCase {
  async execute(refreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    const { secrets, refreshTokens, clock, audit } = this.deps;
    if (!refreshToken) return;
    const record = await refreshTokens.findByHash(secrets.hash(refreshToken));
    if (!record) return;
    await refreshTokens.revokeFamily(record.familyId, clock.now());
    await audit.record({
      actorId: record.userId,
      action: 'auth.logout',
      targetType: 'session',
      targetId: record.familyId,
      request: meta,
    });
  }
}

export class VerifyEmail extends IdentityUseCase {
  async execute(token: string, meta: RequestMeta): Promise<void> {
    const { secrets, oneTimeTokens, users, clock, uow, audit } = this.deps;
    await uow.run(async () => {
      const now = clock.now();
      const userId = await oneTimeTokens.consume(secrets.hash(token), 'EMAIL_VERIFICATION', now);
      const user = userId ? await users.findById(userId) : null;
      if (!user) throw new InvalidOneTimeTokenError();
      user.verifyEmail(now);
      await users.save(user);
      await audit.record({
        actorId: user.id,
        action: 'auth.email_verified',
        targetType: 'user',
        targetId: user.id,
        request: meta,
      });
    });
  }
}

export class ResendEmailVerification extends IdentityUseCase {
  async execute(userId: string): Promise<void> {
    const { users, uow, settings } = this.deps;
    const user = await users.findById(userId);
    if (!user || user.isEmailVerified) return;
    const token = await uow.run(() =>
      this.createOneTimeToken(user.id, 'EMAIL_VERIFICATION', settings.emailVerificationTtlMs),
    );
    await this.sendVerificationEmail(user, token);
  }
}

export class RequestPasswordReset extends IdentityUseCase {
  /** Sempre conclui sem erro: a resposta não pode revelar se o e-mail está cadastrado. */
  async execute(email: string, meta: RequestMeta): Promise<void> {
    const { users, uow, settings, mailer, audit } = this.deps;
    const user = await users.findByEmail(email);
    if (!user?.isActive) return;

    const token = await uow.run(async () => {
      const created = await this.createOneTimeToken(
        user.id,
        'PASSWORD_RESET',
        settings.passwordResetTtlMs,
      );
      await audit.record({
        actorId: null,
        action: 'auth.password_reset_requested',
        targetType: 'user',
        targetId: user.id,
        request: meta,
      });
      return created;
    });

    const url = `${settings.webAppUrl}/redefinir-senha?token=${token}`;
    const minutes = Math.round(settings.passwordResetTtlMs / 60_000);
    await mailer
      .send(passwordResetEmail(user.email, user.displayName, url, minutes))
      .catch(() => undefined);
  }
}

export class ResetPassword extends IdentityUseCase {
  async execute(input: { token: string; password: string }, meta: RequestMeta): Promise<void> {
    const { secrets, oneTimeTokens, users, hasher, refreshTokens, clock, uow, audit } = this.deps;
    // Tudo numa transação: se a nova senha for recusada pela política, o token não é queimado.
    await uow.run(async () => {
      const now = clock.now();
      const userId = await oneTimeTokens.consume(secrets.hash(input.token), 'PASSWORD_RESET', now);
      const user = userId ? await users.findById(userId) : null;
      if (!user?.isActive) throw new InvalidOneTimeTokenError();

      const policy = checkPassword(input.password, user);
      if (!policy.ok) throw policy.error;

      user.changePassword(await hasher.hash(input.password), now);
      // Quem pediu o reset recebeu o link no e-mail, então o e-mail está confirmado.
      user.verifyEmail(now);
      await users.save(user);
      await refreshTokens.revokeAllForUser(user.id, now);
      await oneTimeTokens.invalidateAll(user.id, 'PASSWORD_RESET', now);
      await audit.record({
        actorId: user.id,
        action: 'auth.password_reset',
        targetType: 'user',
        targetId: user.id,
        request: meta,
      });
    });
  }
}

export class GetCurrentUser extends IdentityUseCase {
  async execute(userId: string): Promise<{ user: User; mfaEnabled: boolean }> {
    const user = await this.deps.users.findById(userId);
    if (!user?.isActive) throw new InvalidSessionError('user-inactive');
    return { user, mfaEnabled: Boolean((await this.deps.mfa.find(user.id))?.enabledAt) };
  }
}
