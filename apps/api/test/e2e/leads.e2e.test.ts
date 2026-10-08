import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leads } from '../../src/db/schema/leads.js';
import { CAPTCHA_VERIFIER } from '../../src/modules/leads/leads.module.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

const LANDING = 'https://freelas4devs.test';
let t: TestApp;
const captcha = { accept: true, verify: () => Promise.resolve(captcha.accept) };

const post = (body: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: '/v1/leads', headers: { origin: LANDING }, payload: body });

const lead = (overrides: Record<string, unknown> = {}) => ({
  profile: 'FREELANCER',
  name: 'Júlia Dev',
  email: 'julia@exemplo.com',
  mainStack: 'React',
  consent: true,
  consentVersion: '2026-10-v1',
  utm: { source: 'instagram', campaign: 'lancamento', medium: '' },
  captchaToken: 'ok',
  ...overrides,
});

beforeAll(async () => {
  t = await createTestApp(
    { CORS_ORIGINS: `http://localhost:3000,${LANDING}` },
    {
      overrides: [{ token: CAPTCHA_VERIFIER, value: captcha }],
    },
  );
});

beforeEach(async () => {
  captcha.accept = true;
  await t.redis.flushall();
  await t.database.db.delete(leads);
});

afterAll(async () => {
  await t?.close();
});

describe('waitlist (landing)', () => {
  it('accepts a cross-site submission without CSRF and records consent and UTM', async () => {
    const res = await post(lead());
    expect(res.statusCode).toBe(202);
    expect(res.headers['set-cookie']).toBeUndefined();

    const [row] = await t.database.db.select().from(leads);
    expect(row).toMatchObject({
      profile: 'FREELANCER',
      email: 'julia@exemplo.com',
      mainStack: 'React',
      consentVersion: '2026-10-v1',
      utm: { source: 'instagram', campaign: 'lancamento' },
    });
  });

  it('does not reveal or duplicate existing sign-ups', async () => {
    await post(lead());
    const again = await post(lead({ name: 'Júlia Souza', email: 'JULIA@exemplo.com' }));
    expect(again.statusCode).toBe(202);
    const rows = await t.database.db.select().from(leads);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Júlia Souza');
  });

  it('keeps clients and freelancers separate and ignores stack for clients', async () => {
    await post(lead());
    await post(lead({ profile: 'CLIENT' }));
    const rows = await t.database.db.select().from(leads);
    expect(rows.map((r) => [r.profile, r.mainStack]).sort()).toEqual([
      ['CLIENT', null],
      ['FREELANCER', 'React'],
    ]);
  });

  it('requires explicit consent', async () => {
    const res = await post(lead({ consent: false }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ errors: [{ path: 'body.consent' }] });
  });

  it('silently drops honeypot submissions and rejects failed captchas', async () => {
    expect((await post(lead({ website: 'http://spam.example' }))).statusCode).toBe(202);
    expect(await t.database.db.select().from(leads)).toHaveLength(0);

    captcha.accept = false;
    const res = await post(lead());
    expect(res.statusCode).toBe(400);
    expect(await t.database.db.select().from(leads)).toHaveLength(0);
  });

  it('rate limits by IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1)
      statuses.push((await post(lead({ email: `p${i}@exemplo.com` }))).statusCode);
    expect(statuses.slice(0, 5).every((s) => s === 202)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
