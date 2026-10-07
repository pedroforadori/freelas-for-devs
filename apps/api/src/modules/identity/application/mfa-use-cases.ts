import type { RequestMeta } from '../../../shared/application/audit-log.js';
import {
  InvalidMfaCodeError,
  InvalidOneTimeTokenError,
  InvalidSessionError,
  MfaAlreadyEnabledError,
  MfaMandatoryError,
  MfaNotEnabledError,
  StepUpRequiredError,
  TooManyAttemptsError,
} from '../domain/errors.js';
import { isMfaMandatoryFor, normalizeRecoveryCode, RECOVERY_CODE_COUNT } from '../domain/mfa.js';
import type { User } from '../domain/user.js';
import { type AuthResult, IdentityUseCase } from './use-cases.js';

/** Sessão atual de quem chama (vem do access token verificado). */
export interface SessionContext {
  userId: string;
  sessionId: string;
  aal: 1 | 2;
}

abstract class MfaUseCase extends IdentityUseCase {
  protected async activeUser(userId: string): Promise<User> {
    const user = await this.deps.users.findById(userId);
    if (!user?.isActive) throw new InvalidSessionError('user-inactive');
    return user;
  }

  protected recoveryCodeHash(userId: string, code: string): string {
    return this.deps.secrets.hash(`${userId}:${normalizeRecoveryCode(code)}`);
  }

  /** Valida o código TOTP e o "queima" (passo de tempo não pode ser reutilizado). */
  protected async verifyTotp(userId: string, secretEnc: string, code: string): Promise<boolean> {
    const { totp, cipher, clock, mfa } = this.deps;
    const step = totp.matchStep(cipher.decrypt(secretEnc), code, clock.now());
    return step !== null && (await mfa.claimStep(userId, step));
  }

  /** Gera e grava novos códigos de recuperação; retorna-os em claro uma única vez. */
  protected async issueRecoveryCodes(userId: string): Promise<string[]> {
    const { secrets, ids, mfa } = this.deps;
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => secrets.readableCode());
    await mfa.replaceRecoveryCodes(
      userId,
      codes.map((code) => ({ id: ids.next(), codeHash: this.recoveryCodeHash(userId, code) })),
    );
    return codes;
  }
}

/** Passo 1: gera o segredo (ainda não ativo) e devolve o URI para o QR code. */
export class BeginMfaSetup extends MfaUseCase {
  async execute(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const { mfa, totp, cipher } = this.deps;
    const user = await this.activeUser(userId);
    if ((await mfa.find(userId))?.enabledAt) throw new MfaAlreadyEnabledError();

    const secret = totp.generateSecret();
    await mfa.savePending(userId, cipher.encrypt(secret));
    return { secret, otpauthUrl: totp.provisioningUri(secret, user.email) };
  }
}

/**
 * Passo 2: confirma com um código do app. Ativa o 2FA, emite códigos de recuperação e troca a
 * sessão atual por uma de nível 2 (a antiga é revogada — evita que um token aal=1 sobreviva).
 */
export class ConfirmMfaSetup extends MfaUseCase {
  async execute(
    session: SessionContext,
    code: string,
    meta: RequestMeta,
  ): Promise<AuthResult & { recoveryCodes: string[] }> {
    const { mfa, totp, cipher, clock, uow, refreshTokens, audit } = this.deps;
    const user = await this.activeUser(session.userId);

    return uow.run(async () => {
      const record = await mfa.find(user.id);
      if (!record) throw new MfaNotEnabledError();
      if (record.enabledAt) throw new MfaAlreadyEnabledError();

      const now = clock.now();
      const step = totp.matchStep(cipher.decrypt(record.secretEnc), code, now);
      if (step === null) throw new InvalidMfaCodeError();

      await mfa.enable(user.id, now, step);
      const recoveryCodes = await this.issueRecoveryCodes(user.id);
      await refreshTokens.revokeFamily(session.sessionId, now);
      const upgraded = await this.sessions.start(user, meta, { aal: 2 });
      await audit.record({
        actorId: user.id,
        action: 'auth.mfa_enabled',
        targetType: 'user',
        targetId: user.id,
        request: meta,
      });
      return { user, session: upgraded, mfaEnabled: true, recoveryCodes };
    });
  }
}

/** Conclui o login de quem tem 2FA: código do app ou código de recuperação (uso único). */
export class CompleteMfaLogin extends MfaUseCase {
  async execute(
    input: { challengeToken: string; code?: string | undefined; recoveryCode?: string | undefined },
    meta: RequestMeta,
  ): Promise<AuthResult> {
    const { oneTimeTokens, secrets, clock, mfa, loginLimiter, uow, audit } = this.deps;
    const now = clock.now();
    const challengeHash = secrets.hash(input.challengeToken);

    const challenge = await oneTimeTokens.findValid(challengeHash, 'MFA_CHALLENGE', now);
    if (!challenge) throw new InvalidOneTimeTokenError();

    // Mesmo limitador do login, por conta: 5 códigos errados bloqueiam (6 dígitos = 10^6 combinações).
    const limiterKey = `mfa:${challenge.userId}`;
    const lockedFor = await loginLimiter.lockedFor(limiterKey);
    if (lockedFor > 0) throw new TooManyAttemptsError(lockedFor);

    const user = await this.activeUser(challenge.userId);
    const record = await mfa.find(user.id);
    if (!record?.enabledAt) throw new MfaNotEnabledError();

    const usedRecoveryCode = !input.code && Boolean(input.recoveryCode);
    const valid = input.code
      ? await this.verifyTotp(user.id, record.secretEnc, input.code)
      : input.recoveryCode
        ? await mfa.consumeRecoveryCode(
            user.id,
            this.recoveryCodeHash(user.id, input.recoveryCode),
            now,
          )
        : false;

    if (!valid) {
      await loginLimiter.registerFailure(limiterKey);
      await audit.record({
        actorId: null,
        action: 'auth.mfa_failed',
        targetType: 'user',
        targetId: user.id,
        request: meta,
      });
      throw new InvalidMfaCodeError();
    }

    await loginLimiter.reset(limiterKey);
    return uow.run(async () => {
      // Consumo condicional: o mesmo desafio não abre duas sessões.
      if (!(await oneTimeTokens.consume(challengeHash, 'MFA_CHALLENGE', now))) {
        throw new InvalidOneTimeTokenError();
      }
      const session = await this.sessions.start(user, meta, { aal: 2 });
      await audit.record({
        actorId: user.id,
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        metadata: { mfa: usedRecoveryCode ? 'recovery-code' : 'totp' },
        request: meta,
      });
      return { user, session, mfaEnabled: true };
    });
  }
}

/** Desativa o 2FA (só para quem não é obrigado a tê-lo), exigindo sessão aal=2 e um código atual. */
export class DisableMfa extends MfaUseCase {
  async execute(session: SessionContext, code: string, meta: RequestMeta): Promise<void> {
    const { mfa, uow, audit } = this.deps;
    const user = await this.activeUser(session.userId);
    if (isMfaMandatoryFor(user.roles)) throw new MfaMandatoryError();
    if (session.aal < 2) throw new StepUpRequiredError();

    const record = await mfa.find(user.id);
    if (!record?.enabledAt) throw new MfaNotEnabledError();
    if (!(await this.verifyTotp(user.id, record.secretEnc, code))) throw new InvalidMfaCodeError();

    await uow.run(async () => {
      await mfa.remove(user.id);
      await audit.record({
        actorId: user.id,
        action: 'auth.mfa_disabled',
        targetType: 'user',
        targetId: user.id,
        request: meta,
      });
    });
  }
}
