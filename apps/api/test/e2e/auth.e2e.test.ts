import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BrowserSession,
  createTestApp,
  lastEmailToken,
  type TestApp,
} from '../support/test-app.js';

const password = 'uma senha bem longa';
let t: TestApp;
let counter = 0;

/** E-mail único por teste: o banco é compartilhado no arquivo, o rate limit é zerado a cada teste. */
const freshEmail = () => `pessoa${(counter += 1)}@exemplo.com`;

const signUp = async (browser: BrowserSession, email = freshEmail(), role = 'FREELANCER') => {
  const res = await browser.request('POST', '/v1/auth/register', {
    body: { email, password, displayName: 'Pessoa Teste', role, acceptTerms: true },
  });
  return { res, email };
};

beforeAll(async () => {
  t = await createTestApp();
});

beforeEach(async () => {
  await t.redis.flushall();
});

afterAll(async () => {
  await t?.close();
});

describe('web session (cookies + CSRF)', () => {
  it('registers, sets hardened cookies and serves /me', async () => {
    const browser = await new BrowserSession(t.app).init();
    const { res, email } = await signUp(browser);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      status: 'authenticated',
      user: expect.objectContaining({
        email,
        roles: ['FREELANCER'],
        emailVerified: false,
        mfaEnabled: false,
        sessionAal: 1,
      }),
    });
    expect(JSON.stringify(res.json())).not.toContain('accessToken');

    const setCookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const access = setCookies.find((c) => c.startsWith('__Host-f4d_at='));
    const refresh = setCookies.find((c) => c.startsWith('__Secure-f4d_rt='));
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/Secure/i);
    expect(access).toMatch(/SameSite=Lax/i);
    expect(refresh).toMatch(/Path=\/v1\/auth/);
    expect(refresh).toMatch(/SameSite=Strict/i);

    const me = await browser.request('GET', '/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      email,
      permissions: expect.arrayContaining(['profile:freelancer:write']),
    });
  });

  it('rejects mutations without the CSRF header or from a foreign origin', async () => {
    const browser = await new BrowserSession(t.app).init();
    const body = {
      email: freshEmail(),
      password,
      displayName: 'X Y',
      role: 'CLIENT',
      acceptTerms: true,
    };

    const noHeader = await browser.request('POST', '/v1/auth/register', { body, csrf: false });
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json()).toMatchObject({ code: 'CSRF_FAILED' });

    const foreign = await browser.request('POST', '/v1/auth/register', {
      body,
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('requires authentication for /me', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('logs in, rotates the refresh cookie and logs out', async () => {
    const first = await new BrowserSession(t.app).init();
    const { email } = await signUp(first);

    const browser = await new BrowserSession(t.app).init();
    const wrong = await browser.request('POST', '/v1/auth/login', {
      body: { email, password: 'errada demais 123' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({
      code: 'UNAUTHENTICATED',
      detail: 'E-mail ou senha incorretos.',
    });

    const login = await browser.request('POST', '/v1/auth/login', { body: { email, password } });
    expect(login.statusCode).toBe(200);
    const firstRefresh = browser.cookies.get('__Secure-f4d_rt');

    const refreshed = await browser.request('POST', '/v1/auth/refresh');
    expect(refreshed.statusCode).toBe(200);
    expect(browser.cookies.get('__Secure-f4d_rt')).not.toBe(firstRefresh);

    const logout = await browser.request('POST', '/v1/auth/logout');
    expect(logout.statusCode).toBe(204);
    expect(browser.cookies.has('__Host-f4d_at')).toBe(false);
    expect((await browser.request('POST', '/v1/auth/refresh')).statusCode).toBe(401);
  });

  it('kills the session when a stolen refresh token is replayed', async () => {
    const victim = await new BrowserSession(t.app).init();
    await signUp(victim);
    const stolen = victim.cookies.get('__Secure-f4d_rt')!;

    // A vítima segue usando a sessão normalmente (rotaciona o token)...
    expect((await victim.request('POST', '/v1/auth/refresh')).statusCode).toBe(200);

    // ...e, passado o período de tolerância entre abas, o atacante reapresenta o token antigo.
    t.clock.advance(60_000);
    const replay = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { 'x-f4d-client': 'mobile' },
      payload: { refreshToken: stolen },
    });
    expect(replay.statusCode).toBe(401);

    // A sessão inteira cai: nem o token legítimo atual da vítima vale mais.
    expect((await victim.request('POST', '/v1/auth/refresh')).statusCode).toBe(401);
  });

  it('tolerates two tabs refreshing at once without killing the session', async () => {
    const tabA = await new BrowserSession(t.app).init();
    await signUp(tabA);
    const shared = tabA.cookies.get('__Secure-f4d_rt')!;
    const tabB = new BrowserSession(t.app);
    for (const [name, value] of tabA.cookies) tabB.cookies.set(name, value);

    expect((await tabA.request('POST', '/v1/auth/refresh')).statusCode).toBe(200);
    tabB.cookies.set('__Secure-f4d_rt', shared);
    const raced = await tabB.request('POST', '/v1/auth/refresh');
    expect(raced.statusCode).toBe(409);
    // Sem limpar cookies: no browser real as abas compartilham o mesmo cookie jar.
    expect(raced.headers['set-cookie']).toBeUndefined();

    // A aba A (com o token novo) continua válida.
    expect((await tabA.request('POST', '/v1/auth/refresh')).statusCode).toBe(200);
  });

  it('rejects duplicate e-mails and weak passwords with field-level detail', async () => {
    const browser = await new BrowserSession(t.app).init();
    const { email } = await signUp(browser);
    const duplicate = await signUp(await new BrowserSession(t.app).init(), email);
    expect(duplicate.res.statusCode).toBe(409);

    const weak = await browser.request('POST', '/v1/auth/register', {
      body: {
        email: freshEmail(),
        password: 'curta',
        displayName: 'A B',
        role: 'CLIENT',
        acceptTerms: true,
      },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'body.password' }],
    });

    const noTerms = await browser.request('POST', '/v1/auth/register', {
      body: {
        email: freshEmail(),
        password,
        displayName: 'A B',
        role: 'CLIENT',
        acceptTerms: false,
      },
    });
    expect(noTerms.json()).toMatchObject({ errors: [{ path: 'body.acceptTerms' }] });
  });

  it('refuses self-assigned admin role', async () => {
    const browser = await new BrowserSession(t.app).init();
    const { res } = await signUp(browser, freshEmail(), 'ADMIN');
    expect(res.statusCode).toBe(400);
  });
});

describe('e-mail verification and password reset', () => {
  it('verifies the e-mail with the emailed link', async () => {
    const browser = await new BrowserSession(t.app).init();
    const { email } = await signUp(browser);
    const token = lastEmailToken(t.mail, email, 'auth.verify-email');

    expect(
      (await browser.request('POST', '/v1/auth/email/verify', { body: { token } })).statusCode,
    ).toBe(204);
    expect((await browser.request('GET', '/v1/me')).json()).toMatchObject({ emailVerified: true });
    expect(
      (await browser.request('POST', '/v1/auth/email/verify', { body: { token } })).statusCode,
    ).toBe(400);
  });

  it('resets the password and signs out existing sessions', async () => {
    const browser = await new BrowserSession(t.app).init();
    const { email } = await signUp(browser);

    const anonymous = await new BrowserSession(t.app).init();
    const forgot = await anonymous.request('POST', '/v1/auth/password/forgot', { body: { email } });
    expect(forgot.statusCode).toBe(202);
    const unknown = await anonymous.request('POST', '/v1/auth/password/forgot', {
      body: { email: 'ninguem@exemplo.com' },
    });
    expect(unknown.statusCode).toBe(202);

    const token = lastEmailToken(t.mail, email, 'auth.password-reset');
    const reset = await anonymous.request('POST', '/v1/auth/password/reset', {
      body: { token, password: 'nova senha muito boa' },
    });
    expect(reset.statusCode).toBe(204);

    expect((await browser.request('POST', '/v1/auth/refresh')).statusCode).toBe(401);
    const login = await anonymous.request('POST', '/v1/auth/login', {
      body: { email, password: 'nova senha muito boa' },
    });
    expect(login.statusCode).toBe(200);
  });
});

describe('mobile clients (bearer tokens, no cookies)', () => {
  it('receives tokens in the body and authenticates with Authorization: Bearer', async () => {
    const email = freshEmail();
    const register = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-f4d-client': 'mobile' },
      payload: { email, password, displayName: 'App User', role: 'CLIENT', acceptTerms: true },
    });
    expect(register.statusCode).toBe(201);
    expect(register.headers['set-cookie']).toBeUndefined();
    const { session } = register.json<{ session: { accessToken: string; refreshToken: string } }>();

    const me = await t.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(me.json()).toMatchObject({ email });

    const refreshed = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { 'x-f4d-client': 'mobile' },
      payload: { refreshToken: session.refreshToken },
    });
    expect(refreshed.json()).toMatchObject({ session: { refreshToken: expect.any(String) } });
  });
});

describe('rate limiting', () => {
  it('limits login attempts per IP', async () => {
    const browser = await new BrowserSession(t.app).init();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await browser.request('POST', '/v1/auth/login', {
        body: { email: `alvo${i}@exemplo.com`, password: 'qualquer coisa' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('locks an account after repeated failures from different IPs', async () => {
    const owner = await new BrowserSession(t.app).init();
    const { email } = await signUp(owner);

    for (let i = 0; i < 5; i += 1) {
      await t.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-f4d-client': 'mobile', 'x-forwarded-for': `198.51.100.${i}` },
        payload: { email, password: 'tentativa errada 123' },
      });
    }
    const locked = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-f4d-client': 'mobile', 'x-forwarded-for': '198.51.100.99' },
      payload: { email, password },
    });
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
