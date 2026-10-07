import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProvisionAdmin } from '../../src/modules/identity/application/admin-use-cases.js';
import { totpCodeAt } from '../fakes/identity.js';
import { ProbeController } from '../support/probe.controller.js';
import { BrowserSession, createTestApp, type TestApp } from '../support/test-app.js';

let t: TestApp;
let counter = 0;
const password = 'uma senha bem longa';

beforeAll(async () => {
  t = await createTestApp({}, { controllers: [ProbeController] });
});

beforeEach(async () => {
  await t.redis.flushall();
});

afterAll(async () => {
  await t?.close();
});

/** Cadastra no browser e ativa o 2FA; devolve o segredo e os códigos de recuperação. */
const enrollMfa = async (browser: BrowserSession) => {
  const email = `mfa${(counter += 1)}@exemplo.com`;
  await browser.request('POST', '/v1/auth/register', {
    body: { email, password, displayName: 'Pessoa Teste', role: 'CLIENT', acceptTerms: true },
  });
  const setup = await browser.request('POST', '/v1/auth/mfa/setup');
  expect(setup.statusCode).toBe(200);
  const { secret } = setup.json<{ secret: string }>();
  const enable = await browser.request('POST', '/v1/auth/mfa/enable', {
    body: { code: totpCodeAt(secret, t.clock.now()) },
  });
  expect(enable.statusCode).toBe(200);
  return { email, secret, recoveryCodes: enable.json<{ recoveryCodes: string[] }>().recoveryCodes };
};

describe('two-factor authentication over HTTP', () => {
  it('enables 2FA and upgrades the browser session to aal2', async () => {
    const browser = await new BrowserSession(t.app).init();
    const { recoveryCodes } = await enrollMfa(browser);
    expect(recoveryCodes).toHaveLength(10);

    const me = await browser.request('GET', '/v1/me');
    expect(me.json()).toMatchObject({ mfaEnabled: true, sessionAal: 2 });
  });

  it('logs in with password + code, without setting cookies before the second factor', async () => {
    const { email, secret } = await enrollMfa(await new BrowserSession(t.app).init());
    t.clock.advance(60_000);

    const browser = await new BrowserSession(t.app).init();
    const login = await browser.request('POST', '/v1/auth/login', { body: { email, password } });
    expect(login.json()).toMatchObject({ status: 'mfa_required', expiresInSeconds: 300 });
    expect(browser.cookies.has('__Host-f4d_at')).toBe(false);

    const { challengeToken } = login.json<{ challengeToken: string }>();
    const wrong = await browser.request('POST', '/v1/auth/mfa/verify', {
      body: { challengeToken, code: '000000' },
    });
    expect(wrong.statusCode).toBe(400);

    const verify = await browser.request('POST', '/v1/auth/mfa/verify', {
      body: { challengeToken, code: totpCodeAt(secret, t.clock.now()) },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ status: 'authenticated', user: { sessionAal: 2 } });
    expect((await browser.request('GET', '/v1/me')).statusCode).toBe(200);
  });

  it('keeps aal2 across refresh rotations', async () => {
    const browser = await new BrowserSession(t.app).init();
    await enrollMfa(browser);
    expect((await browser.request('POST', '/v1/auth/refresh')).json()).toMatchObject({
      user: { sessionAal: 2 },
    });
  });

  it('validates that exactly one of code or recovery code is sent', async () => {
    const browser = await new BrowserSession(t.app).init();
    const res = await browser.request('POST', '/v1/auth/mfa/verify', {
      body: { challengeToken: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('authorization guard', () => {
  it('denies handlers without an access contract (deny by default)', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/test/forgotten' });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('leaked');
  });

  it('forbids admin routes to non-admins and demands 2FA from admins', async () => {
    const client = await new BrowserSession(t.app).init();
    await enrollMfa(client);
    expect((await client.request('GET', '/v1/test/admin-probe')).json()).toMatchObject({
      code: 'FORBIDDEN',
    });

    const provisioned = await t.app
      .get(ProvisionAdmin)
      .execute({ email: 'chefe@exemplo.com', displayName: 'Chefe' });
    const token = new URL(provisioned.passwordSetupUrl).searchParams.get('token')!;
    const admin = await new BrowserSession(t.app).init();
    await admin.request('POST', '/v1/auth/password/reset', {
      body: { token, password: 'cavalo correto bateria grampo' },
    });
    await admin.request('POST', '/v1/auth/login', {
      body: { email: 'chefe@exemplo.com', password: 'cavalo correto bateria grampo' },
    });

    // Admin sem 2FA: autenticado, mas barrado nas rotas administrativas.
    const blocked = await admin.request('GET', '/v1/test/admin-probe');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'MFA_REQUIRED' });

    const { secret } = (await admin.request('POST', '/v1/auth/mfa/setup')).json<{
      secret: string;
    }>();
    await admin.request('POST', '/v1/auth/mfa/enable', {
      body: { code: totpCodeAt(secret, t.clock.now()) },
    });
    expect((await admin.request('GET', '/v1/test/admin-probe')).json()).toEqual({ ok: true });

    // E não consegue desativar o 2FA.
    t.clock.advance(30_000);
    const disable = await admin.request('POST', '/v1/auth/mfa/disable', {
      body: { code: totpCodeAt(secret, t.clock.now()) },
    });
    expect(disable.statusCode).toBe(403);
  });
});
