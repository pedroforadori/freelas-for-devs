import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/db/schema/audit.js';
import { users } from '../../src/db/schema/identity.js';
import { freelancerProfiles } from '../../src/db/schema/profiles.js';
import { PurgeExpiredData } from '../../src/modules/privacy/application/use-cases.js';
import { DESCRIPTION, marketplace } from '../support/marketplace.js';
import {
  BrowserSession,
  createAdminSession,
  createTestApp,
  type TestApp,
} from '../support/test-app.js';

let t: TestApp;
let admin: BrowserSession;
let m: ReturnType<typeof marketplace>;

const PASSWORD = 'uma senha bem longa';
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  t = await createTestApp();
  m = marketplace(t, () => admin);
});

beforeEach(async () => {
  await t.database.reset();
  await t.redis.flushall();
  t.mail.jobs.length = 0;
  admin = await createAdminSession(t);
});

afterAll(async () => {
  await t?.close();
});

describe('data export (LGPD art. 18)', () => {
  it('returns everything about the person and nothing secret', async () => {
    const client = await m.register('CLIENT', 'Cliente');
    await client.browser.request('POST', '/v1/projects', {
      body: { title: 'Site da padaria', type: 'SITE', description: DESCRIPTION, attachmentIds: [] },
    });
    const response = await client.browser.request('GET', '/v1/me/data-export');
    expect(response.statusCode).toBe(200);
    const data = response.json<{
      format: string;
      account: { email: string; roles: string[] };
      projects: { title: string }[];
    }>();
    expect(data).toMatchObject({
      format: 'freelas4devs-export/v1',
      account: { email: client.email, roles: ['CLIENT'] },
      projects: [{ title: 'Site da padaria' }],
    });
    expect(response.body).not.toMatch(/passwordHash|password_hash|\$argon2|tokenHash|secretEnc/);
    const audits = await t.database.db.select().from(auditLog);
    expect(audits.some((a) => a.action === 'privacy.data_exported')).toBe(true);
  });
});

describe('account deletion', () => {
  it('is blocked while there are open projects or contracts', async () => {
    const { client, ana } = await m.activeContract();
    for (const person of [client, ana]) {
      const check = (await person.browser.request('GET', '/v1/me/deletion-check')).json<{
        canDelete: boolean;
        blockers: { kind: string }[];
      }>();
      expect(check.canDelete).toBe(false);
      expect(check.blockers.map((b) => b.kind)).toContain('OPEN_CONTRACTS');
      const attempt = await person.browser.request('POST', '/v1/me/delete', {
        body: { confirmation: 'EXCLUIR MINHA CONTA', password: PASSWORD },
      });
      expect(attempt.statusCode).toBe(409);
    }
  });

  it('anonymizes the account, ends the session and frees the e-mail', async () => {
    const ana = await m.freelancer('Ana');
    const wrong = await ana.browser.request('POST', '/v1/me/delete', {
      body: { confirmation: 'EXCLUIR MINHA CONTA', password: 'senha errada mesmo' },
    });
    expect(wrong.statusCode).toBe(400);
    const typo = await ana.browser.request('POST', '/v1/me/delete', {
      body: { confirmation: 'excluir', password: PASSWORD },
    });
    expect(typo.statusCode).toBe(400);

    const deleted = await ana.browser.request('POST', '/v1/me/delete', {
      body: { confirmation: 'EXCLUIR MINHA CONTA', password: PASSWORD },
    });
    expect(deleted.statusCode).toBe(204);
    expect(ana.browser.cookies.has('f4d_at')).toBe(false);

    const [row] = await t.database.db.select().from(users).where(eq(users.id, ana.userId));
    expect(row).toMatchObject({
      displayName: 'Conta excluída',
      status: 'DELETED',
      passwordHash: null,
    });
    expect(row!.email).not.toBe(ana.email);
    const [profile] = await t.database.db
      .select()
      .from(freelancerProfiles)
      .where(eq(freelancerProfiles.userId, ana.userId));
    expect(profile).toMatchObject({ headline: '', bio: '', available: false });

    const login = await (
      await new BrowserSession(t.app).init()
    ).request('POST', '/v1/auth/login', {
      body: { email: ana.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(401);
    const again = await (
      await new BrowserSession(t.app).init()
    ).request('POST', '/v1/auth/register', {
      body: {
        email: ana.email,
        password: PASSWORD,
        displayName: 'Ana de novo',
        role: 'FREELANCER',
        acceptTerms: true,
      },
    });
    expect(again.statusCode).toBe(201);
  });
});

describe('retention', () => {
  it('erases the original text of contact attempts after the retention period', async () => {
    const client = await m.register('CLIENT', 'Cliente');
    const created = await client.browser.request('POST', '/v1/projects', {
      body: { title: 'Site da padaria', type: 'SITE', description: DESCRIPTION, attachmentIds: [] },
    });
    const projectId = created.json<{ id: string }>().id;
    const { GenerateEstimate } =
      await import('../../src/modules/projects/application/use-cases.js');
    await t.app.get(GenerateEstimate).execute(projectId, 1);
    const { id } = (
      await client.browser.request('GET', `/v1/projects/${projectId}/conversation`)
    ).json<{ id: string }>();
    await client.browser.request('POST', `/v1/conversations/${id}/messages`, {
      body: { body: 'me chama no zap 11 98765-4321' },
    });

    t.clock.advance(181 * DAY);
    const purged = await t.app.get(PurgeExpiredData).execute();
    expect(purged.violationOriginals).toBe(1);
    admin = await createAdminSession(t);
    const [violation] = (await admin.request('GET', '/v1/admin/moderation/violations')).json<{
      items: { id: string }[];
    }>().items;
    const revealed = await admin.request(
      'POST',
      `/v1/admin/moderation/violations/${violation!.id}/reveal`,
    );
    expect(revealed.json<{ originalText: string }>().originalText).toContain('prazo de retenção');
  });
});

describe('closed beta', () => {
  it('only lets invited e-mails sign up (password or social login)', async () => {
    const settings = (await admin.request('GET', '/v1/admin/settings')).json<{
      items: { key: string; version: number }[];
    }>();
    const mode = settings.items.find((item) => item.key === 'access.signupMode')!;
    await admin.request('PUT', '/v1/admin/settings/access.signupMode', {
      body: { value: 'INVITE_ONLY', expectedVersion: mode.version },
    });

    const signUp = async (email: string) =>
      (await new BrowserSession(t.app).init()).request('POST', '/v1/auth/register', {
        body: {
          email,
          password: PASSWORD,
          displayName: 'Pessoa',
          role: 'CLIENT',
          acceptTerms: true,
        },
      });
    const refused = await signUp('fora@exemplo.com');
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ detail: string }>().detail).toContain('beta fechado');

    await (
      await new BrowserSession(t.app).init()
    ).request('POST', '/v1/leads', {
      body: {
        profile: 'CLIENT',
        name: 'Convidada',
        email: 'convidada@exemplo.com',
        consent: true,
        consentVersion: '2026-10-v1',
      },
    });
    const invite = await admin.request('POST', '/v1/admin/beta/invites', {
      body: { emails: ['Convidada@exemplo.com'] },
    });
    expect(invite.json()).toEqual({ invited: 1 });
    expect(t.mail.jobs.some((job) => job.data.tag === 'leads.beta-invite')).toBe(true);
    expect((await signUp('convidada@exemplo.com')).statusCode).toBe(201);

    const overview = (await admin.request('GET', '/v1/admin/beta')).json<{
      signupMode: string;
      waitlist: { email: string; invitedAt: string | null; registered: boolean }[];
    }>();
    expect(overview.signupMode).toBe('INVITE_ONLY');
    expect(overview.waitlist).toEqual([
      expect.objectContaining({ email: 'convidada@exemplo.com', registered: true }),
    ]);
  });
});
