import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OAuthProfile, OAuthProvider } from '../../src/modules/identity/application/ports.js';
import { OAUTH_PROVIDERS } from '../../src/modules/identity/infrastructure/oauth-providers.js';
import { totpCodeAt } from '../fakes/identity.js';
import { BrowserSession, createTestApp, type TestApp } from '../support/test-app.js';

/** Provedor falso: o "código" devolvido pelo provedor indica qual perfil retornar. */
class FakeGitHub implements OAuthProvider {
  readonly name = 'github' as const;
  readonly profiles = new Map<string, OAuthProfile>();
  authorizationUrl(state: string): URL {
    return new URL(`https://github.test/login/oauth/authorize?state=${state}`);
  }
  fetchProfile(code: string): Promise<OAuthProfile> {
    const profile = this.profiles.get(code);
    return profile ? Promise.resolve(profile) : Promise.reject(new Error('code inválido'));
  }
}

const github = new FakeGitHub();
let t: TestApp;

beforeAll(async () => {
  t = await createTestApp(
    {},
    { overrides: [{ token: OAUTH_PROVIDERS, value: new Map([['github', github]]) }] },
  );
});

afterAll(async () => {
  await t?.close();
});

/** Simula o vaivém do browser: inicia no app, "autoriza" no provedor e volta ao callback. */
const roundTrip = async (
  browser: BrowserSession,
  code: string,
  start = '/v1/auth/oauth/github?role=FREELANCER&redirectTo=/painel',
) => {
  const started = await browser.request('GET', start);
  const state = new URL(started.headers.location as string).searchParams.get('state')!;
  return {
    started,
    callback: await browser.request(
      'GET',
      `/v1/auth/oauth/github/callback?code=${code}&state=${state}`,
    ),
  };
};

describe('OAuth login over HTTP', () => {
  it('redirects to the provider with a short-lived, encrypted state cookie', async () => {
    const browser = new BrowserSession(t.app);
    const res = await browser.request('GET', '/v1/auth/oauth/github');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(
      /^https:\/\/github\.test\/login\/oauth\/authorize\?state=/,
    );

    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('__Secure-f4d_oauth='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/v1\/auth\/oauth/);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).not.toContain('codeVerifier');
  });

  it('creates the account, opens a session and returns to the requested page', async () => {
    github.profiles.set('ok-1', {
      provider: 'github',
      providerUserId: '1',
      email: 'dev1@exemplo.com',
      emailVerified: true,
      displayName: 'Dev Um',
    });
    const browser = new BrowserSession(t.app);
    const { callback } = await roundTrip(browser, 'ok-1');

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('https://app.test/painel');
    expect(browser.cookies.has('__Host-f4d_at')).toBe(true);
    expect((await browser.request('GET', '/v1/me')).json()).toMatchObject({
      email: 'dev1@exemplo.com',
      roles: ['FREELANCER'],
      emailVerified: true,
    });
  });

  it('rejects a callback whose state does not match the cookie (login CSRF)', async () => {
    github.profiles.set('ok-2', {
      provider: 'github',
      providerUserId: '2',
      email: 'dev2@exemplo.com',
      emailVerified: true,
      displayName: 'Dev Dois',
    });
    const victim = new BrowserSession(t.app);
    await victim.request('GET', '/v1/auth/oauth/github');
    const res = await victim.request(
      'GET',
      '/v1/auth/oauth/github/callback?code=ok-2&state=forjado',
    );

    expect(res.headers.location).toBe('https://app.test/entrar?erro=oauth-expirado');
    expect(victim.cookies.has('__Host-f4d_at')).toBe(false);
  });

  it('rejects open redirects and unknown providers', async () => {
    const browser = new BrowserSession(t.app);
    expect(
      (await browser.request('GET', '/v1/auth/oauth/github?redirectTo=//evil.com')).statusCode,
    ).toBe(400);
    expect((await browser.request('GET', '/v1/auth/oauth/google')).statusCode).toBe(404);
  });

  it('reports cancellation and unverified e-mails back to the web app', async () => {
    const browser = new BrowserSession(t.app);
    await browser.request('GET', '/v1/auth/oauth/github');
    const cancelled = await browser.request(
      'GET',
      '/v1/auth/oauth/github/callback?error=access_denied',
    );
    expect(cancelled.headers.location).toBe('https://app.test/entrar?erro=oauth-cancelado');

    github.profiles.set('unverified', {
      provider: 'github',
      providerUserId: '3',
      email: 'dev3@exemplo.com',
      emailVerified: false,
      displayName: 'Dev Três',
    });
    const { callback } = await roundTrip(new BrowserSession(t.app), 'unverified');
    expect(callback.headers.location).toBe(
      'https://app.test/entrar?erro=oauth-email-nao-verificado',
    );
  });

  it('sends accounts with 2FA to the verification step without opening a session', async () => {
    github.profiles.set('mfa', {
      provider: 'github',
      providerUserId: '4',
      email: 'dev4@exemplo.com',
      emailVerified: true,
      displayName: 'Dev Quatro',
    });
    const first = new BrowserSession(t.app);
    await roundTrip(first, 'mfa');
    await first.init();
    const { secret } = (await first.request('POST', '/v1/auth/mfa/setup')).json<{
      secret: string;
    }>();
    await first.request('POST', '/v1/auth/mfa/enable', {
      body: { code: totpCodeAt(secret, t.clock.now()) },
    });

    const second = new BrowserSession(t.app);
    const { callback } = await roundTrip(second, 'mfa');
    expect(callback.headers.location).toMatch(/^https:\/\/app\.test\/entrar\/verificacao#desafio=/);
    expect(second.cookies.has('__Host-f4d_at')).toBe(false);
  });
});
