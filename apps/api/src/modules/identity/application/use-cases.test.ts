import { beforeEach, describe, expect, it } from 'vitest';
import { createIdentityTestDeps } from '../../../../test/fakes/identity.js';
import { SYSTEM_REQUEST } from '../../../shared/application/audit-log.js';
import { HOUR_MS } from '../../../shared/kernel/clock.js';
import {
  AccountSuspendedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidOneTimeTokenError,
  InvalidSessionError,
  SessionSupersededError,
  TooManyAttemptsError,
  WeakPasswordError,
} from '../domain/errors.js';
import { User } from '../domain/user.js';
import {
  GetCurrentUser,
  LoginWithPassword,
  Logout,
  RefreshSession,
  RegisterUser,
  RequestPasswordReset,
  ResetPassword,
  VerifyEmail,
} from './use-cases.js';

const meta = { ...SYSTEM_REQUEST, ip: '203.0.113.7', userAgent: 'vitest' };
const credentials = {
  email: 'ana@exemplo.com',
  password: 'uma senha bem longa',
  displayName: 'Ana Lima',
};

let deps: ReturnType<typeof createIdentityTestDeps>;
const register = () => new RegisterUser(deps).execute({ ...credentials, role: 'CLIENT' }, meta);
const login = (password = credentials.password) =>
  new LoginWithPassword(deps).execute({ email: credentials.email, password }, meta);

beforeEach(() => {
  deps = createIdentityTestDeps();
});

describe('RegisterUser', () => {
  it('creates the account, starts a session and sends the verification e-mail', async () => {
    const { user, session } = await register();

    expect(user.roles).toEqual(['CLIENT']);
    expect(user.isEmailVerified).toBe(false);
    expect(session.refreshToken).toHaveLength(43);
    expect(deps.refreshTokens.rows[0]?.tokenHash).not.toBe(session.refreshToken);
    expect(deps.mailer.sent[0]).toMatchObject({ to: 'ana@exemplo.com', tag: 'auth.verify-email' });
    expect(deps.audit.actions()).toEqual(['auth.register']);
    expect(deps.users.events.map((e) => e.type)).toEqual(['identity.UserRegistered']);
  });

  it('rejects a duplicate e-mail', async () => {
    await register();
    await expect(register()).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('enforces the password policy before touching storage', async () => {
    await expect(
      new RegisterUser(deps).execute(
        { ...credentials, password: 'senha12345', role: 'CLIENT' },
        meta,
      ),
    ).rejects.toBeInstanceOf(WeakPasswordError);
    expect(deps.users.rows.size).toBe(0);
  });
});

describe('LoginWithPassword', () => {
  beforeEach(register);

  it('starts a new session with valid credentials', async () => {
    const { user } = await login();
    // Uma sessão do cadastro e outra do login: cada dispositivo tem a sua.
    expect(deps.refreshTokens.activeFamilies(user.id).size).toBe(2);
    expect(deps.audit.actions()).toContain('auth.login');
  });

  it('gives the same error for unknown e-mail and wrong password, spending hash time on both', async () => {
    await expect(login('senha errada qualquer')).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(
      new LoginWithPassword(deps).execute({ email: 'ninguem@exemplo.com', password: 'x' }, meta),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(deps.hasher.dummyCalls).toBe(1);
    expect(deps.audit.actions().filter((a) => a === 'auth.login_failed')).toHaveLength(2);
  });

  it('locks the account after repeated failures, even with the right password', async () => {
    for (let i = 0; i < 5; i += 1) await expect(login('errada demais 123')).rejects.toThrow();
    await expect(login()).rejects.toBeInstanceOf(TooManyAttemptsError);
  });

  it('blocks suspended accounts', async () => {
    const [id] = deps.users.rows.keys();
    const row = deps.users.rows.get(id!)!;
    deps.users.rows.set(id!, { ...row, status: 'SUSPENDED' });
    await expect(login()).rejects.toBeInstanceOf(AccountSuspendedError);
  });
});

describe('RefreshSession', () => {
  it('rotates the refresh token within the same session', async () => {
    const { session } = await register();
    deps.clock.advance(60_000);

    const refreshed = await new RefreshSession(deps).execute(session.refreshToken, meta);

    expect(refreshed.session.sessionId).toBe(session.sessionId);
    expect(refreshed.session.refreshToken).not.toBe(session.refreshToken);
  });

  it('revokes the whole session when a rotated token is replayed (theft)', async () => {
    const { user, session } = await register();
    deps.clock.advance(60_000);
    const refreshed = await new RefreshSession(deps).execute(session.refreshToken, meta);

    deps.clock.advance(60_000);
    await expect(
      new RefreshSession(deps).execute(session.refreshToken, meta),
    ).rejects.toMatchObject({
      details: { reason: 'reused' },
    });
    await expect(
      new RefreshSession(deps).execute(refreshed.session.refreshToken, meta),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    expect(deps.refreshTokens.activeFamilies(user.id).size).toBe(0);
    expect(deps.audit.actions()).toContain('auth.refresh_reuse_detected');
  });

  it('does not revoke the session when two tabs refresh at the same time', async () => {
    const { user, session } = await register();
    await new RefreshSession(deps).execute(session.refreshToken, meta);
    deps.clock.advance(1_000);
    await expect(
      new RefreshSession(deps).execute(session.refreshToken, meta),
    ).rejects.toBeInstanceOf(SessionSupersededError);
    expect(deps.refreshTokens.activeFamilies(user.id).size).toBe(1);
  });

  it('rejects expired and unknown tokens', async () => {
    const { session } = await register();
    deps.clock.advance(31 * 24 * HOUR_MS);
    await expect(
      new RefreshSession(deps).execute(session.refreshToken, meta),
    ).rejects.toMatchObject({
      details: { reason: 'expired' },
    });
    await expect(new RefreshSession(deps).execute('nao-existe', meta)).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
  });
});

describe('Logout', () => {
  it('revokes the current session only', async () => {
    const { user, session } = await register();
    await login();
    await new Logout(deps).execute(session.refreshToken, meta);
    expect(deps.refreshTokens.activeFamilies(user.id).size).toBe(1);
  });
});

describe('VerifyEmail', () => {
  it('confirms the e-mail once with the token from the message', async () => {
    const { user } = await register();
    const token = deps.mailer.lastToken(user.email, 'auth.verify-email');

    await new VerifyEmail(deps).execute(token, meta);
    expect((await new GetCurrentUser(deps).execute(user.id)).isEmailVerified).toBe(true);
    await expect(new VerifyEmail(deps).execute(token, meta)).rejects.toBeInstanceOf(
      InvalidOneTimeTokenError,
    );
  });

  it('rejects expired tokens', async () => {
    const { user } = await register();
    const token = deps.mailer.lastToken(user.email, 'auth.verify-email');
    deps.clock.advance(25 * HOUR_MS);
    await expect(new VerifyEmail(deps).execute(token, meta)).rejects.toBeInstanceOf(
      InvalidOneTimeTokenError,
    );
  });
});

describe('password reset', () => {
  it('does not reveal whether the e-mail exists', async () => {
    await new RequestPasswordReset(deps).execute('ninguem@exemplo.com', meta);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it('changes the password, verifies the e-mail and signs out every session', async () => {
    const { user } = await register();
    await login();
    await new RequestPasswordReset(deps).execute(user.email, meta);
    const token = deps.mailer.lastToken(user.email, 'auth.password-reset');

    await new ResetPassword(deps).execute({ token, password: 'outra senha muito boa' }, meta);

    expect(deps.refreshTokens.activeFamilies(user.id).size).toBe(0);
    await expect(login()).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(login('outra senha muito boa')).resolves.toBeDefined();
    expect(User.rehydrate(deps.users.rows.get(user.id)!).isEmailVerified).toBe(true);
  });

  it('only honors the latest reset link', async () => {
    const { user } = await register();
    await new RequestPasswordReset(deps).execute(user.email, meta);
    const first = deps.mailer.lastToken(user.email, 'auth.password-reset');
    await new RequestPasswordReset(deps).execute(user.email, meta);

    await expect(
      new ResetPassword(deps).execute({ token: first, password: 'outra senha muito boa' }, meta),
    ).rejects.toBeInstanceOf(InvalidOneTimeTokenError);
  });
});
