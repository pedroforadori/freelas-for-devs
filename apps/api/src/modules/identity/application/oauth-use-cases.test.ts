import { beforeEach, describe, expect, it } from 'vitest';
import { createIdentityTestDeps, totpCodeAt } from '../../../../test/fakes/identity.js';
import { SYSTEM_REQUEST } from '../../../shared/application/audit-log.js';
import { InvalidCredentialsError, OAuthEmailNotVerifiedError } from '../domain/errors.js';
import { BeginMfaSetup, ConfirmMfaSetup } from './mfa-use-cases.js';
import { SignInWithOAuth } from './oauth-use-cases.js';
import type { OAuthProfile } from './ports.js';
import { LoginWithPassword, RegisterUser, VerifyEmail } from './use-cases.js';

const meta = SYSTEM_REQUEST;
let deps: ReturnType<typeof createIdentityTestDeps>;

const profile = (overrides: Partial<OAuthProfile> = {}): OAuthProfile => ({
  provider: 'github',
  providerUserId: '4242',
  email: 'carla@exemplo.com',
  emailVerified: true,
  displayName: 'Carla Dev',
  ...overrides,
});

const signIn = async (p: OAuthProfile, role?: 'CLIENT' | 'FREELANCER') => {
  const outcome = await new SignInWithOAuth(deps).execute(p, { role }, meta);
  if (outcome.kind !== 'authenticated') throw new Error('esperava sessão');
  return outcome;
};

beforeEach(() => {
  deps = createIdentityTestDeps();
});

describe('SignInWithOAuth', () => {
  it('creates a verified, password-less account with the chosen role', async () => {
    const { user } = await signIn(profile(), 'FREELANCER');
    expect(user.roles).toEqual(['FREELANCER']);
    expect(user.isEmailVerified).toBe(true);
    expect(user.passwordHash).toBeNull();
    expect(deps.authIdentities.links).toHaveLength(1);
    expect(deps.audit.actions()).toEqual(['auth.register', 'auth.login']);
  });

  it('signs into the same account on the next login, even if the provider e-mail changed', async () => {
    const first = await signIn(profile());
    const second = await signIn(profile({ email: 'novo@exemplo.com' }));
    expect(second.user.id).toBe(first.user.id);
    expect(deps.users.rows.size).toBe(1);
  });

  it('refuses providers that did not verify the e-mail', async () => {
    await expect(
      new SignInWithOAuth(deps).execute(profile({ emailVerified: false }), {}, meta),
    ).rejects.toBeInstanceOf(OAuthEmailNotVerifiedError);
  });

  it('links to an existing verified account, keeping its password', async () => {
    const { user } = await new RegisterUser(deps).execute(
      {
        email: 'carla@exemplo.com',
        password: 'uma senha bem longa',
        displayName: 'Carla',
        role: 'CLIENT',
      },
      meta,
    );
    await new VerifyEmail(deps).execute(
      deps.mailer.lastToken('carla@exemplo.com', 'auth.verify-email'),
      meta,
    );

    const { user: linked } = await signIn(profile());
    expect(linked.id).toBe(user.id);
    const outcome = await new LoginWithPassword(deps).execute(
      { email: 'carla@exemplo.com', password: 'uma senha bem longa' },
      meta,
    );
    expect(outcome.kind).toBe('authenticated');
  });

  it('defeats pre-account hijacking: an unverified pre-registration loses its password and sessions', async () => {
    // Invasor cadastra o e-mail da vítima com uma senha que ele conhece (sem conseguir verificar).
    const attacker = await new RegisterUser(deps).execute(
      {
        email: 'carla@exemplo.com',
        password: 'senha do invasor 123',
        displayName: 'X',
        role: 'CLIENT',
      },
      meta,
    );

    // A vítima entra com o GitHub, que comprova o controle do e-mail.
    const { user } = await signIn(profile());
    expect(user.id).toBe(attacker.user.id);
    expect(user.isEmailVerified).toBe(true);

    await expect(
      new LoginWithPassword(deps).execute(
        { email: 'carla@exemplo.com', password: 'senha do invasor 123' },
        meta,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(
      deps.refreshTokens.rows.find((r) => r.familyId === attacker.session.sessionId)?.revokedAt,
    ).not.toBeNull();
  });

  it('still requires the second factor for accounts with 2FA', async () => {
    const { user, session } = await signIn(profile());
    const { secret } = await new BeginMfaSetup(deps).execute(user.id);
    await new ConfirmMfaSetup(deps).execute(
      { userId: user.id, sessionId: session.sessionId, aal: 1 },
      totpCodeAt(secret, deps.clock.now()),
      meta,
    );

    const outcome = await new SignInWithOAuth(deps).execute(profile(), {}, meta);
    expect(outcome.kind).toBe('mfa_required');
  });
});
