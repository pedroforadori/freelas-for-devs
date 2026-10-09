import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/db/schema/audit.js';
import { outboxEvents } from '../../src/db/schema/outbox.js';
import { GenerateEstimate } from '../../src/modules/projects/application/use-cases.js';
import {
  BrowserSession,
  createAdminSession,
  createTestApp,
  type TestApp,
} from '../support/test-app.js';

let t: TestApp;
let counter = 0;
let admin: BrowserSession;

const DETAILED =
  'Preciso de uma loja virtual para vender roupas femininas, com catálogo por categorias, ' +
  'carrinho, pagamento com Pix e cartão, cálculo de frete e um painel para eu cadastrar produtos.';

const scope = (overrides: Record<string, unknown> = {}) => ({
  type: 'ECOMMERCE',
  objective: 'Loja virtual de roupas femininas com pagamento online e gestão de pedidos.',
  features: ['Catálogo por categorias', 'Carrinho e checkout com Pix e cartão', 'Cálculo de frete'],
  screens: ['Home', 'Categoria', 'Produto', 'Carrinho', 'Painel de pedidos'],
  acceptanceCriteria: ['Compra de ponta a ponta em produção', 'Painel cadastra e edita produtos'],
  requiredStacks: ['shopify'],
  levelSlug: 'intermediario',
  priceRange: { minCents: 600_000, maxCents: 900_000 },
  deadlineDays: 45,
  notesForFreelancers: 'Cliente já tem domínio e logo.',
  ...overrides,
});

/** Cliente com um projeto já estimado (em SCOPING). */
const projectInScoping = async () => {
  const client = await new BrowserSession(t.app).init();
  const email = `escopo${(counter += 1)}@exemplo.com`;
  await client.request('POST', '/v1/auth/register', {
    body: {
      email,
      password: 'uma senha bem longa',
      displayName: 'Ana',
      role: 'CLIENT',
      acceptTerms: true,
    },
  });
  const created = await client.request('POST', '/v1/projects', {
    body: { title: 'Loja de roupas', type: 'ECOMMERCE', description: DETAILED },
  });
  const { id } = created.json<{ id: string }>();
  await t.app.get(GenerateEstimate).execute(id, 1);
  return { client, email, id };
};

const saveScope = (id: string, body = scope()) =>
  admin.request('PUT', `/v1/admin/projects/${id}/scope`, { body });

beforeAll(async () => {
  t = await createTestApp();
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

describe('scoping a project', () => {
  it('versions the scope and approves exactly the reviewed version', async () => {
    const { client, email, id } = await projectInScoping();

    const v1 = await saveScope(id);
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toMatchObject({ status: 'SCOPING', scope: { levelSlug: 'intermediario' } });
    // Rascunho do especialista não aparece para o cliente.
    expect((await client.request('GET', `/v1/projects/${id}`)).json()).toMatchObject({
      scope: null,
    });

    await saveScope(id, scope({ deadlineDays: 50 }));
    const stale = await admin.request('POST', `/v1/admin/projects/${id}/approve`, {
      body: { version: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ detail: expect.stringContaining('versão atual: 2') });

    const approved = await admin.request('POST', `/v1/admin/projects/${id}/approve`, {
      body: { version: 2 },
    });
    expect(approved.json()).toMatchObject({
      status: 'READY_FOR_QUEUE',
      scopeApprovedAt: expect.any(String),
      scopeVersions: [
        { version: 2, createdBy: 'Admin', scope: { deadlineDays: 50 } },
        { version: 1, scope: { deadlineDays: 45 } },
      ],
    });

    const shown = (await client.request('GET', `/v1/projects/${id}`)).json<{
      status: string;
      scope: Record<string, unknown>;
    }>();
    expect(shown.status).toBe('READY_FOR_QUEUE');
    expect(shown.scope).toMatchObject({
      deadlineDays: 50,
      notesForFreelancers: expect.any(String),
    });
    expect(shown.scope).not.toHaveProperty('levelSlug');

    // A fila (F5) consome este evento.
    const [event] = await t.database.db
      .select()
      .from(outboxEvents)
      .where(
        and(eq(outboxEvents.aggregateId, id), eq(outboxEvents.type, 'projects.ScopeApproved')),
      );
    expect(event?.payload).toMatchObject({
      version: 2,
      levelSlug: 'intermediario',
      type: 'ECOMMERCE',
      requiredStacks: ['shopify'],
    });
    expect(t.mail.jobs.find((job) => job.data.tag === 'projects.scope-approved')?.data.to).toBe(
      email,
    );
    const actions = (
      await t.database.db.select().from(auditLog).where(eq(auditLog.targetId, id))
    ).map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining(['admin.project_scope_saved', 'admin.project_scope_approved']),
    );
  });

  it('validates the scope against the catalog and the configured limits', async () => {
    const { id } = await projectInScoping();

    expect((await saveScope(id, scope({ levelSlug: 'guru' }))).json()).toMatchObject({
      status: 400,
      detail: 'Nível desconhecido: guru.',
    });
    expect((await saveScope(id, scope({ requiredStacks: ['cobol'] }))).statusCode).toBe(400);
    const inverted = await saveScope(id, scope({ priceRange: { minCents: 900_000, maxCents: 1 } }));
    expect(inverted.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe(
      'body.priceRange.maxCents',
    );

    const cheap = scope({ priceRange: { minCents: 30_000, maxCents: 80_000 } });
    expect((await saveScope(id, cheap)).json()).toMatchObject({
      status: 400,
      detail: expect.stringContaining('R$ 500'),
    });
    // O Admin baixa o mínimo nas configurações e o mesmo escopo passa.
    await admin.request('PUT', '/v1/admin/settings/scope.minPriceCents', {
      body: { value: 20_000, expectedVersion: 0 },
    });
    expect((await saveScope(id, cheap)).statusCode).toBe(200);
  });

  it('rejects a project with a reason the client can see', async () => {
    const { client, email, id } = await projectInScoping();
    const reason = 'Pedido fora de desenvolvimento de software (serviço de design gráfico).';
    const rejected = await admin.request('POST', `/v1/admin/projects/${id}/reject`, {
      body: { reason },
    });
    expect(rejected.json()).toMatchObject({ status: 'REJECTED' });
    expect((await client.request('GET', `/v1/projects/${id}`)).json()).toMatchObject({
      status: 'REJECTED',
      rejectionReason: reason,
    });
    expect(t.mail.jobs.find((job) => job.data.tag === 'projects.rejected')?.data).toMatchObject({
      to: email,
      text: expect.stringContaining(reason),
    });
    expect(
      (await client.request('POST', `/v1/projects/${id}/cancel`, { body: {} })).statusCode,
    ).toBe(409);
  });

  it('reopens an approved scope and lets the client cancel before distribution', async () => {
    const { client, id } = await projectInScoping();
    await saveScope(id);
    await admin.request('POST', `/v1/admin/projects/${id}/approve`, { body: { version: 1 } });

    const reopened = await admin.request('POST', `/v1/admin/projects/${id}/reopen`);
    expect(reopened.json()).toMatchObject({ status: 'SCOPING', scopeApprovedAt: null });
    expect((await client.request('GET', `/v1/projects/${id}`)).json()).toMatchObject({
      scope: null,
    });

    await admin.request('POST', `/v1/admin/projects/${id}/approve`, { body: { version: 1 } });
    const cancelled = await client.request('POST', `/v1/projects/${id}/cancel`, { body: {} });
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });
  });

  it('only lets admins scope, and only while scoping', async () => {
    const { client, id } = await projectInScoping();
    expect(
      (await client.request('PUT', `/v1/admin/projects/${id}/scope`, { body: scope() })).statusCode,
    ).toBe(403);

    const other = await client.request('POST', '/v1/projects', {
      body: { title: 'Outro projeto', type: 'SITE', description: DETAILED },
    });
    const estimating = other.json<{ id: string }>().id;
    expect((await saveScope(estimating)).statusCode).toBe(409);
    expect(
      (
        await admin.request('POST', `/v1/admin/projects/${estimating}/approve`, {
          body: { version: 1 },
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe('scoping metrics', () => {
  it('measures the queue, time to approve and AI estimate deviation', async () => {
    const first = await projectInScoping();
    const waiting = await projectInScoping();
    const estimate = (await admin.request('GET', `/v1/admin/projects/${first.id}`)).json<{
      estimate: { priceRange: { minCents: number; maxCents: number } };
    }>().estimate;

    t.clock.advance(5 * 60 * 60 * 1000);
    // Faixa aprovada 50% acima do ponto médio da IA.
    const aiMid = (estimate.priceRange.minCents + estimate.priceRange.maxCents) / 2;
    await saveScope(
      first.id,
      scope({ priceRange: { minCents: aiMid * 1.5 - 100_000, maxCents: aiMid * 1.5 + 100_000 } }),
    );
    await admin.request('POST', `/v1/admin/projects/${first.id}/approve`, { body: { version: 1 } });

    const metrics = (await admin.request('GET', '/v1/admin/metrics/scoping')).json();
    expect(metrics).toEqual({
      queue: { scoping: 1, oldestWaitingHours: 5 },
      last30Days: {
        approved: 1,
        rejected: 0,
        medianHoursToApprove: 5,
        p90HoursToApprove: 5,
        avgVersionsPerApproval: 1,
        estimateDeviation: { samples: 1, medianPct: 50 },
      },
    });
    expect(waiting.id).not.toBe(first.id);
  });
});

describe('business settings', () => {
  it('lists defaults and changes values with validation, locking and audit', async () => {
    const list = (await admin.request('GET', '/v1/admin/settings')).json<{
      items: { key: string; value: unknown; version: number }[];
    }>();
    expect(list.items.find((item) => item.key === 'payments.commissionBps')).toMatchObject({
      value: 1000,
      version: 0,
    });

    const update = (value: unknown, expectedVersion: number) =>
      admin.request('PUT', '/v1/admin/settings/payments.commissionBps', {
        body: { value, expectedVersion },
      });
    expect((await update(9_900, 0)).statusCode).toBe(400);
    expect((await update(1_200, 0)).json()).toMatchObject({
      value: 1200,
      version: 1,
      updatedBy: 'Admin',
    });
    // Outra aba ainda com a versão 0.
    expect((await update(1_500, 0)).statusCode).toBe(409);
    expect((await update(1_500, 1)).json()).toMatchObject({ value: 1500, version: 2 });

    const audit = await t.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'admin.setting_changed'));
    expect(audit.map((entry) => entry.metadata)).toEqual([
      { before: 1000, after: 1200 },
      { before: 1200, after: 1500 },
    ]);

    const { client } = await projectInScoping();
    expect((await client.request('GET', '/v1/admin/settings')).statusCode).toBe(403);
  });
});
