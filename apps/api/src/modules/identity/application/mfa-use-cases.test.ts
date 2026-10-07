import { beforeEach, describe, expect, it } from 'vitest';
import { createIdentityTestDeps, totpCodeAt } from '../../../../test/fakes/identity.js';
import { SYSTEM_REQUEST } from '../../../shared/application/audit-log.js';
import {
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidOneTimeTokenError,
  MfaAlreadyEnabledError,
  MfaMandatoryError,
  StepUpRequiredError,
  TooManyAttemptsError,
} from '../domain/errors.js';
import { ProvisionAdmin } from './admin-use-cases.js';
import { BeginMfaSetup, CompleteMfaLogin, ConfirmMfaSetup, DisableMfa } from './mfa-use-cases.js';
import { LoginWithPassword, RegisterUser, ResetPassword } from './use-cases.js';

const meta = SYSTEM_REQUEST;
const email = 'bia@exemplo.com';
const password = 'uma senha bem longa';
let deps: ReturnType<typeof createIdentityTestDeps>;

const register = () =>
  new RegisterUser(deps).execute({ email, password, displayName: 'Bia', role: 'FREELANCER' }, meta);

/** Cadastra, configura e ativa o 2FA; devolve o segredo e os códigos de recuperação. */
const enrolled = async () => {
  const { user, session } = await register();
  const { secret } = await new BeginMfaSetup(deps).execute(user.id);
  const enabled = await new ConfirmMfaSetup(deps).execute(
    { userId: user.id, sessionId: session.sessionId, aal: 1 },
    totpCodeAt(secret, deps.clock.now()),
    meta,
  );
  return { user, secret, enabled, oldSession: session };
};

const loginChallenge = async () => {
  const outcome = await new LoginWithPassword(deps).execute({ email, password }, meta);
  if (outcome.kind !== 'mfa_required') throw new Error('esperava desafio de 2FA');
  return outcome.challengeToken;
};

beforeEach(() => {
  deps = createIdentityTestDeps();
});

describe('MFA setup', () => {
  it('returns a provisioning URI and keeps the secret encrypted at rest', async () => {
    const { user } = await register();
    const { secret, otpauthUrl } = await new BeginMfaSetup(deps).execute(user.id);

    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\/Freelas%204%20Devs:bia%40exemplo\.com\?/);
    const stored = deps.mfa.records.get(user.id);
    expect(stored?.secretEnc).not.toContain(secret);
    expect(stored?.enabledAt).toBeNull();
  });

  it('enables with a valid code, issues recovery codes and upgrades the session', async () => {
    const { user, enabled, oldSession } = await enrolled();

    expect(enabled.recoveryCodes).toHaveLength(10);
    expect(new Set(enabled.recoveryCodes).size).toBe(10);
    expect(enabled.session.aal).toBe(2);
    expect(deps.accessTokens.issued.at(-1)).toMatchObject({ userId: user.id, aal: 2 });
    // A sessão nível 1 anterior não sobrevive.
    expect(deps.refreshTokens.activeFamilies(user.id)).not.toContain(oldSession.sessionId);
    expect(deps.audit.actions()).toContain('auth.mfa_enabled');
  });

  it('rejects a wrong confirmation code and a second setup once enabled', async () => {
    const { user, session } = await register();
    await new BeginMfaSetup(deps).execute(user.id);
    await expect(
      new ConfirmMfaSetup(deps).execute(
        { userId: user.id, sessionId: session.sessionId, aal: 1 },
        '000000',
        meta,
      ),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    deps = createIdentityTestDeps();
    const { user: enrolledUser } = await enrolled();
    await expect(new BeginMfaSetup(deps).execute(enrolledUser.id)).rejects.toBeInstanceOf(
      MfaAlreadyEnabledError,
    );
  });
});

describe('MFA login', () => {
  it('requires the second factor after the password and grants an aal2 session', async () => {
    const { secret } = await enrolled();
    deps.clock.advance(60_000);

    const challengeToken = await loginChallenge();
    const result = await new CompleteMfaLogin(deps).execute(
      { challengeToken, code: totpCodeAt(secret, deps.clock.now()) },
      meta,
    );
    expect(result.session.aal).toBe(2);
    expect(result.mfaEnabled).toBe(true);
  });

  it('refuses to reuse the same code (replay) and the same challenge twice', async () => {
    const { secret } = await enrolled();
    deps.clock.advance(60_000);
    const code = totpCodeAt(secret, deps.clock.now());

    await new CompleteMfaLogin(deps).execute(
      { challengeToken: await loginChallenge(), code },
      meta,
    );
    await expect(
      new CompleteMfaLogin(deps).execute({ challengeToken: await loginChallenge(), code }, meta),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);

    deps.clock.advance(30_000);
    const challengeToken = await loginChallenge();
    await new CompleteMfaLogin(deps).execute(
      { challengeToken, code: totpCodeAt(secret, deps.clock.now()) },
      meta,
    );
    deps.clock.advance(30_000);
    await expect(
      new CompleteMfaLogin(deps).execute(
        { challengeToken, code: totpCodeAt(secret, deps.clock.now()) },
        meta,
      ),
    ).rejects.toBeInstanceOf(InvalidOneTimeTokenError);
  });

  it('accepts each recovery code once, in any formatting', async () => {
    const { enabled } = await enrolled();
    const code = enabled.recoveryCodes[0]!;

    await new CompleteMfaLogin(deps).execute(
      { challengeToken: await loginChallenge(), recoveryCode: ` ${code.toUpperCase()} ` },
      meta,
    );
    await expect(
      new CompleteMfaLogin(deps).execute(
        { challengeToken: await loginChallenge(), recoveryCode: code },
        meta,
      ),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);
    expect(deps.audit.entries.at(-2)).toMatchObject({ metadata: { mfa: 'recovery-code' } });
  });

  it('locks after repeated wrong codes', async () => {
    await enrolled();
    const challengeToken = await loginChallenge();
    for (let i = 0; i < 5; i += 1) {
      await expect(
        new CompleteMfaLogin(deps).execute({ challengeToken, code: '000000' }, meta),
      ).rejects.toBeInstanceOf(InvalidMfaCodeError);
    }
    await expect(
      new CompleteMfaLogin(deps).execute({ challengeToken, code: '000000' }, meta),
    ).rejects.toBeInstanceOf(TooManyAttemptsError);
  });

  it('expires the challenge after five minutes', async () => {
    const { secret } = await enrolled();
    const challengeToken = await loginChallenge();
    deps.clock.advance(5 * 60_000 + 1);
    await expect(
      new CompleteMfaLogin(deps).execute(
        { challengeToken, code: totpCodeAt(secret, deps.clock.now()) },
        meta,
      ),
    ).rejects.toBeInstanceOf(InvalidOneTimeTokenError);
  });
});

describe('DisableMfa', () => {
  it('requires an aal2 session and a fresh code', async () => {
    const { user, secret, enabled } = await enrolled();
    const context = { userId: user.id, sessionId: enabled.session.sessionId, aal: 1 as const };
    await expect(new DisableMfa(deps).execute(context, '123456', meta)).rejects.toBeInstanceOf(
      StepUpRequiredError,
    );

    deps.clock.advance(30_000);
    await new DisableMfa(deps).execute(
      { ...context, aal: 2 },
      totpCodeAt(secret, deps.clock.now()),
      meta,
    );
    const outcome = await new LoginWithPassword(deps).execute({ email, password }, meta);
    expect(outcome.kind).toBe('authenticated');
  });
});

describe('ProvisionAdmin', () => {
  it('creates a password-less, verified admin and sends a setup link', async () => {
    const result = await new ProvisionAdmin(deps).execute({
      email: 'fundador@exemplo.com',
      displayName: 'Fundador',
    });

    expect(result.created).toBe(true);
    expect(result.passwordSetupUrl).toMatch(/^https:\/\/app\.test\/redefinir-senha\?token=/);
    const admin = await deps.users.findByEmail('fundador@exemplo.com');
    expect(admin?.roles).toEqual(['ADMIN']);
    expect(admin?.isEmailVerified).toBe(true);
    expect(deps.audit.actions()).toContain('admin.provisioned');

    // Sem senha definida, não há como entrar...
    await expect(
      new LoginWithPassword(deps).execute(
        { email: 'fundador@exemplo.com', password: 'qualquer coisa' },
        meta,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    // ...até usar o link enviado.
    const token = new URL(result.passwordSetupUrl).searchParams.get('token')!;
    await new ResetPassword(deps).execute(
      { token, password: 'cavalo correto bateria grampo' },
      meta,
    );
    const outcome = await new LoginWithPassword(deps).execute(
      { email: 'fundador@exemplo.com', password: 'cavalo correto bateria grampo' },
      meta,
    );
    expect(outcome.kind).toBe('authenticated');
  });

  it('promotes an existing account and forbids disabling MFA for admins', async () => {
    const { user, secret, enabled } = await enrolled();
    const result = await new ProvisionAdmin(deps).execute({ email, displayName: 'ignorado' });
    expect(result.created).toBe(false);
    expect((await deps.users.findById(user.id))?.roles).toEqual(['ADMIN', 'FREELANCER']);

    await expect(
      new DisableMfa(deps).execute(
        { userId: user.id, sessionId: enabled.session.sessionId, aal: 2 },
        totpCodeAt(secret, deps.clock.now()),
        meta,
      ),
    ).rejects.toBeInstanceOf(MfaMandatoryError);
  });
});
