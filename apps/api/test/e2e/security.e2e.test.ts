import { apiRoutes, MFA_REQUIRED_PERMISSIONS, type RouteContract } from '@f4d/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProvisionAdmin } from '../../src/modules/identity/application/admin-use-cases.js';
import { marketplace } from '../support/marketplace.js';
import {
  BrowserSession,
  createAdminSession,
  createTestApp,
  type TestApp,
} from '../support/test-app.js';

/**
 * Checklist de segurança automatizado (docs/security/owasp-checklist.md): percorre TODAS as rotas
 * do contrato — uma rota nova entra no teste sem ninguém lembrar dela.
 */
let t: TestApp;

const ID = '00000000-0000-7000-8000-000000000000';
const routes = Object.values(apiRoutes).flatMap((group) =>
  Object.values(group as Record<string, RouteContract>),
);
const urlOf = (route: RouteContract) =>
  route.path.replace(/\{(\w+)\}/g, (_, name: string) =>
    name === 'provider'
      ? 'github'
      : name === 'key'
        ? 'queue.roundSize'
        : name === 'slug'
          ? 'iniciante'
          : ID,
  );
const method = (route: RouteContract) =>
  route.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const permissionOf = (route: RouteContract) =>
  typeof route.auth === 'object' ? route.auth.permission : null;

beforeAll(async () => {
  t = await createTestApp({ RATE_LIMIT_PER_MINUTE: '100000' });
});

afterAll(async () => {
  await t?.close();
});

describe('authorization matrix (A01)', () => {
  it('has no private route answering without a session', async () => {
    const anonymous = await new BrowserSession(t.app).init();
    const leaks: string[] = [];
    for (const route of routes.filter((r) => r.auth !== 'public')) {
      const response = await anonymous.request(method(route), urlOf(route), {
        ...(route.method === 'get' ? {} : { body: {} }),
      });
      if (response.statusCode !== 401)
        leaks.push(`${route.method} ${route.path} → ${response.statusCode}`);
    }
    expect(leaks).toEqual([]);
  });

  it('refuses admin routes to clients and freelancers', async () => {
    let admin: BrowserSession | undefined;
    const m = marketplace(t, () => admin!);
    const client = await m.register('CLIENT', 'Cliente');
    const freelancer = await m.register('FREELANCER', 'Dev');
    const leaks: string[] = [];
    for (const route of routes.filter((r) => permissionOf(r)?.startsWith('admin:'))) {
      for (const person of [client, freelancer]) {
        const response = await person.browser.request(method(route), urlOf(route), {
          ...(route.method === 'get' ? {} : { body: {} }),
        });
        if (response.statusCode !== 403)
          leaks.push(`${route.method} ${route.path} → ${response.statusCode}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('requires a second factor for every admin permission', async () => {
    // Admin com senha, mas sem 2FA ativo: sessão de nível 1.
    const email = 'admin-sem-2fa@freelas4devs.test';
    const password = 'cavalo correto bateria grampo';
    const provisioned = await t.app.get(ProvisionAdmin).execute({ email, displayName: 'Admin' });
    const token = new URL(provisioned.passwordSetupUrl).searchParams.get('token')!;
    const admin = await new BrowserSession(t.app).init();
    await admin.request('POST', '/v1/auth/password/reset', { body: { token, password } });
    await admin.request('POST', '/v1/auth/login', { body: { email, password } });
    const adminRoutes = routes.filter((route) => {
      const permission = permissionOf(route);
      return permission !== null && MFA_REQUIRED_PERMISSIONS.has(permission);
    });
    expect(adminRoutes.length).toBeGreaterThan(20);
    const leaks: string[] = [];
    for (const route of adminRoutes) {
      const response = await admin.request(method(route), urlOf(route), {
        ...(route.method === 'get' ? {} : { body: {} }),
      });
      if (response.statusCode !== 403)
        leaks.push(`${route.method} ${route.path} → ${response.statusCode}`);
    }
    expect(leaks).toEqual([]);
  });
});

describe('object-level access (IDOR)', () => {
  it("hides other people's resources behind 404", async () => {
    const admin = await createAdminSession(t);
    const m = marketplace(t, () => admin);
    const { client, projectId, contractId, ana } = await m.activeContract();
    const intruder = await m.register('CLIENT', 'Intrusa');
    const otherDev = await m.freelancer('Outro');
    const conversation = (
      await client.browser.request('GET', `/v1/contracts/${contractId}/conversation`)
    ).json<{ id: string }>();
    const probes: [BrowserSession, string][] = [
      [intruder.browser, `/v1/projects/${projectId}`],
      [intruder.browser, `/v1/projects/${projectId}/proposals`],
      [intruder.browser, `/v1/contracts/${contractId}`],
      [otherDev.browser, `/v1/contracts/${contractId}`],
      [intruder.browser, `/v1/contracts/${contractId}/conversation`],
      [otherDev.browser, `/v1/conversations/${conversation.id}/messages`],
      [intruder.browser, `/v1/projects/${projectId}/contract`],
    ];
    for (const [browser, url] of probes) {
      expect([url, (await browser.request('GET', url)).statusCode]).toEqual([url, 404]);
    }
    // A outra parte também não age no lugar de ninguém.
    const review = await ana.browser.request('POST', `/v1/contracts/${contractId}/review`, {
      body: { decision: 'APPROVE' },
    });
    expect(review.statusCode).toBe(403);
  });
});

describe('input hardening (A03/A04)', () => {
  it('rejects unknown fields (mass assignment) and oversized bodies', async () => {
    const browser = await new BrowserSession(t.app).init();
    const register = await browser.request('POST', '/v1/auth/register', {
      body: {
        email: 'massa@exemplo.com',
        password: 'uma senha bem longa',
        displayName: 'Massa',
        role: 'CLIENT',
        acceptTerms: true,
        roles: ['ADMIN'],
      },
    });
    expect(register.statusCode).toBe(400);

    const huge = await browser.request('POST', '/v1/auth/login', {
      body: { email: 'a@b.com', password: 'x'.repeat(2 * 1024 * 1024) },
    });
    expect(huge.statusCode).toBe(413);
  });

  it('never leaks internals in error responses', async () => {
    const browser = await new BrowserSession(t.app).init();
    const response = await browser.request('GET', '/v1/projects/nao-e-um-uuid');
    const text = response.body;
    expect(text).not.toMatch(/at \w+ \(|node_modules|stack|SELECT |postgres/i);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });
});
