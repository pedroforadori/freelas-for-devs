import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/db/schema/audit.js';
import { queueEntries } from '../../src/db/schema/distribution.js';
import {
  AdvanceDisputes,
  ExecuteSettlement,
  ExpireUnpaidExtras,
  RetryPendingSettlements,
} from '../../src/modules/contracts/application/disputes.js';
import { PAYMENT_GATEWAY } from '../../src/modules/contracts/contracts.module.js';
import type { FakePaymentGateway } from '../../src/modules/contracts/infrastructure/fake-gateway.js';
import { PenalizeAbandonment } from '../../src/modules/distribution/application/use-cases.js';
import { marketplace, type Person } from '../support/marketplace.js';
import {
  type BrowserSession,
  createAdminSession,
  createTestApp,
  type TestApp,
} from '../support/test-app.js';

let t: TestApp;
let admin: BrowserSession;
let gateway: FakePaymentGateway;
let m: ReturnType<typeof marketplace>;

const DAY = 24 * 60 * 60 * 1000;

interface ContractView {
  status: string;
  paused: boolean;
  amounts: { clientTotalCents: number; freelancerNetCents: number };
  work: { dueAt: string; stage: string | null } | null;
  outOfScope: { id: string; status: string; clientTotalCents: number }[];
  dispute: {
    id: string;
    kind: string;
    status: string;
    statements: unknown[];
    resolution: { freelancerCents: number; refundCents: number } | null;
  } | null;
}

const view = async (person: Person, contractId: string) =>
  (await person.browser.request('GET', `/v1/contracts/${contractId}`)).json<ContractView>();

const post = (person: Person | BrowserSession, path: string, body?: unknown) =>
  ('browser' in person ? person.browser : person).request('POST', path, {
    ...(body === undefined ? {} : { body }),
  });

const flag = (ana: Person, contractId: string) =>
  post(ana, `/v1/contracts/${contractId}/out-of-scope`, {
    description: 'O cliente pediu uma área de login para clientes, que não estava no escopo.',
    amountCents: 50_000,
    extraDays: 5,
  });

const adminContract = async (projectId: string) =>
  (await admin.request('GET', `/v1/admin/projects/${projectId}/contract`)).json<{
    escrowBalanceCents: number;
    payments: { refundedCents: number; outOfScopeId: string | null; status: string }[];
  }>();

const openDispute = (client: Person, contractId: string) =>
  post(client, `/v1/contracts/${contractId}/disputes`, {
    reason: 'QUALITY',
    description: 'A entrega não funciona no celular e o dev parou de responder há uma semana.',
  });

const statement = (person: Person, contractId: string, text: string) =>
  post(person, `/v1/contracts/${contractId}/dispute/statements`, { text });

beforeAll(async () => {
  t = await createTestApp();
  gateway = t.app.get<FakePaymentGateway>(PAYMENT_GATEWAY);
  m = marketplace(t, () => admin);
});

beforeEach(async () => {
  await t.database.reset();
  await t.redis.flushall();
  t.mail.jobs.length = 0;
  gateway.transfers.length = 0;
  gateway.refunds.length = 0;
  admin = await createAdminSession(t);
});

afterAll(async () => {
  await t?.close();
});

describe('out of scope', () => {
  it('pauses the contract until the client pays the extra, which joins the escrow', async () => {
    const { ana, client, contractId, projectId } = await m.activeContract();
    const dueBefore = (await view(client, contractId)).work!.dueAt;

    expect((await flag(ana, contractId)).statusCode).toBe(201);
    let contract = await view(client, contractId);
    expect(contract.paused).toBe(true);
    const [request] = contract.outOfScope;
    expect(request).toMatchObject({ status: 'EXTRA_PROPOSED', clientTotalCents: 50_000 });
    expect(t.mail.jobs.some((job) => job.data.tag === 'contracts.out-of-scope-flagged')).toBe(true);

    // Só o cliente responde; o dev não aceita o próprio pedido.
    const base = `/v1/contracts/${contractId}/out-of-scope/${request!.id}`;
    expect((await post(ana, `${base}/accept`)).statusCode).toBe(403);
    expect((await post(client, `${base}/accept`)).statusCode).toBe(200);
    const { url } = (await post(client, `${base}/checkout`)).json<{ url: string }>();
    t.clock.advance(2 * DAY);
    await post(client, '/v1/dev/payments/simulate', {
      checkoutId: new URL(url).searchParams.get('checkout'),
      outcome: 'succeeded',
    });

    contract = await view(client, contractId);
    expect(contract).toMatchObject({
      paused: false,
      amounts: { clientTotalCents: 350_000, freelancerNetCents: 315_000 },
      outOfScope: [{ status: 'ACCEPTED_FUNDED' }],
    });
    // Prazo: +2 dias pausado e +5 dias do adicional.
    expect(new Date(contract.work!.dueAt).getTime() - new Date(dueBefore).getTime()).toBe(7 * DAY);
    const money = await adminContract(projectId);
    expect(money.escrowBalanceCents).toBe(350_000);
    expect(money.payments.filter((p) => p.outOfScopeId === request!.id)).toHaveLength(1);
  });

  it('lets the mediation rule a contested request as already in scope', async () => {
    const { ana, client, contractId } = await m.activeContract();
    await flag(ana, contractId);
    const [request] = (await view(client, contractId)).outOfScope;
    const base = `/v1/contracts/${contractId}/out-of-scope/${request!.id}`;
    await post(client, `${base}/contest`, {
      reason: 'A área de login está no item 3 das funcionalidades aprovadas.',
    });
    const ruling = { decision: 'IN_SCOPE', note: 'O item 3 do escopo prevê o login.' };
    const rulingPath = `/v1/admin/contracts/${contractId}/out-of-scope/${request!.id}/ruling`;
    expect((await post(client, rulingPath, ruling)).statusCode).toBe(403);
    expect((await admin.request('POST', rulingPath, { body: ruling })).statusCode).toBe(204);

    const contract = await view(ana, contractId);
    expect(contract).toMatchObject({ paused: false, outOfScope: [{ status: 'RULED_IN_SCOPE' }] });
    expect(
      t.mail.jobs.filter((job) => job.data.tag === 'contracts.out-of-scope-ruled').length,
    ).toBe(2);
  });

  it('blocks approval while a request is pending and expires unpaid extras', async () => {
    const { ana, client, contractId } = await m.activeContract();
    await post(ana, `/v1/contracts/${contractId}/deliveries`, {
      message: 'Entrega com as páginas prontas. Teste pelo link.',
    });
    await flag(ana, contractId);
    const [request] = (await view(client, contractId)).outOfScope;
    const approve = await post(client, `/v1/contracts/${contractId}/review`, {
      decision: 'APPROVE',
    });
    expect(approve.statusCode).toBe(400);

    await post(client, `/v1/contracts/${contractId}/out-of-scope/${request!.id}/accept`);
    t.clock.advance(4 * DAY);
    expect(await t.app.get(ExpireUnpaidExtras).execute()).toBe(1);
    expect(await view(client, contractId)).toMatchObject({
      paused: false,
      outOfScope: [{ status: 'WITHDRAWN' }],
    });
    expect(
      (await post(client, `/v1/contracts/${contractId}/review`, { decision: 'APPROVE' }))
        .statusCode,
    ).toBe(200);
  });
});

describe('disputes', () => {
  it('collects both versions and splits the escrow by the decision', async () => {
    const { ana, client, contractId, projectId } = await m.activeContract();
    expect((await openDispute(client, contractId)).statusCode).toBe(201);
    let contract = await view(ana, contractId);
    expect(contract).toMatchObject({
      status: 'DISPUTED',
      paused: true,
      dispute: { kind: 'DISPUTE', status: 'OPEN' },
    });
    expect(t.mail.jobs.find((job) => job.data.tag === 'contracts.dispute-opened')?.data.to).toBe(
      ana.email,
    );
    expect((await openDispute(client, contractId)).statusCode).toBe(400);

    await statement(client, contractId, 'Segue o print da tela quebrada no celular.');
    await statement(ana, contractId, 'Corrigi o layout mobile na última entrega, ver o vídeo.');
    expect((await view(client, contractId)).dispute).toMatchObject({ status: 'UNDER_REVIEW' });
    expect((await post(client, `/v1/contracts/${contractId}/dispute/withdraw`)).statusCode).toBe(
      400,
    );

    const list = (await admin.request('GET', '/v1/admin/disputes')).json<{
      items: { id: string; statements: number; project: { id: string } }[];
    }>();
    expect(list.items).toMatchObject([{ statements: 2, project: { id: projectId } }]);

    await ana.browser.request('POST', '/v1/me/payout-account/onboarding');
    const disputeId = list.items[0]!.id;
    const resolve = await admin.request('POST', `/v1/admin/disputes/${disputeId}/resolve`, {
      body: { freelancerShareBps: 6000, note: 'O dev entregou cerca de 60% do combinado.' },
    });
    expect(resolve.statusCode).toBe(204);
    expect(await t.app.get(ExecuteSettlement).execute(disputeId)).toBe('CLOSED');

    contract = await view(client, contractId);
    expect(contract).toMatchObject({
      status: 'SETTLED',
      dispute: { status: 'CLOSED', resolution: { freelancerCents: 162_000, refundCents: 120_000 } },
    });
    expect(gateway.refunds).toEqual([expect.objectContaining({ amountCents: 120_000 })]);
    expect(gateway.transfers).toEqual([expect.objectContaining({ amountCents: 162_000 })]);
    const money = await adminContract(projectId);
    expect(money.escrowBalanceCents).toBe(0);
    expect(money.payments[0]).toMatchObject({ status: 'SUCCEEDED', refundedCents: 120_000 });
    const project = (await client.browser.request('GET', `/v1/projects/${projectId}`)).json<{
      status: string;
    }>();
    expect(project.status).toBe('CLOSED_BY_DISPUTE');
    const audits = await t.database.db.select().from(auditLog);
    expect(audits.some((a) => a.action === 'admin.dispute_resolved')).toBe(true);

    // Repetir a execução não repete reembolso nem repasse.
    expect(await t.app.get(ExecuteSettlement).execute(disputeId)).toBe('SKIPPED');
    expect(gateway.refunds).toHaveLength(1);
  });

  it('refunds right away and waits for the payout account to pay the freelancer', async () => {
    const { ana, client, contractId } = await m.activeContract();
    await openDispute(client, contractId);
    t.clock.advance(4 * DAY);
    expect(await t.app.get(AdvanceDisputes).execute()).toBe(1);
    const { dispute } = await view(client, contractId);
    expect(dispute?.status).toBe('UNDER_REVIEW');

    await admin.request('POST', `/v1/admin/disputes/${dispute!.id}/resolve`, {
      body: { freelancerShareBps: 5000, note: 'Metade do trabalho foi entregue e aceita.' },
    });
    expect(await t.app.get(ExecuteSettlement).execute(dispute!.id)).toBe('WAITING_ACCOUNT');
    expect(gateway.refunds).toHaveLength(1);
    const waiting = (await admin.request('GET', '/v1/admin/disputes')).json<{
      items: { waitingFor: string | null }[];
    }>();
    expect(waiting.items[0]?.waitingFor).toBe('Conta de recebimento do freelancer');

    await ana.browser.request('POST', '/v1/me/payout-account/onboarding');
    expect(await t.app.get(RetryPendingSettlements).execute()).toBe(1);
    expect((await view(ana, contractId)).status).toBe('SETTLED');
    expect(gateway.transfers).toEqual([expect.objectContaining({ amountCents: 135_000 })]);
  });

  it('resumes the contract with extended deadlines when the opener withdraws', async () => {
    const { ana, client, contractId } = await m.activeContract();
    const dueBefore = new Date((await view(client, contractId)).work!.dueAt).getTime();
    await openDispute(client, contractId);
    expect((await post(ana, `/v1/contracts/${contractId}/dispute/withdraw`)).statusCode).toBe(400);
    t.clock.advance(2 * DAY);
    expect((await post(client, `/v1/contracts/${contractId}/dispute/withdraw`)).statusCode).toBe(
      200,
    );
    const contract = await view(client, contractId);
    expect(contract).toMatchObject({ status: 'ACTIVE', paused: false });
    expect(new Date(contract.work!.dueAt).getTime() - dueBefore).toBe(2 * DAY);
  });

  it('refunds everything when the decision gives nothing to the freelancer', async () => {
    const { client, contractId } = await m.activeContract();
    await openDispute(client, contractId);
    const { dispute } = await view(client, contractId);
    await admin.request('POST', `/v1/admin/disputes/${dispute!.id}/resolve`, {
      body: { freelancerShareBps: 0, note: 'Nada do combinado foi entregue no prazo.' },
    });
    expect(await t.app.get(ExecuteSettlement).execute(dispute!.id)).toBe('CLOSED');
    expect(gateway.refunds).toEqual([expect.objectContaining({ amountCents: 300_000 })]);
    expect(gateway.transfers).toEqual([]);
  });
});

describe('abandonment', () => {
  it('opens a non-withdrawable dispute, penalizes the queue and shows in the stats', async () => {
    const { ana, client, contractId } = await m.activeContract();
    const abandon = await post(ana, `/v1/contracts/${contractId}/abandon`, {
      description: 'Tive um problema de saúde e não vou conseguir terminar o projeto.',
    });
    expect(abandon.statusCode).toBe(200);
    expect(await view(client, contractId)).toMatchObject({
      status: 'DISPUTED',
      dispute: { kind: 'ABANDONMENT', status: 'OPEN' },
    });
    expect((await post(ana, `/v1/contracts/${contractId}/dispute/withdraw`)).statusCode).toBe(400);

    // O worker recebe ContractAbandoned.
    await t.app.get(PenalizeAbandonment).execute(ana.userId);
    const [entry] = await t.database.db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.userId, ana.userId));
    expect(entry).toMatchObject({ abandonments: 1, tier: 'NORMAL' });
    expect(entry!.lastInvitedAt!.getTime()).toBeGreaterThan(t.clock.now().getTime() + 29 * DAY);

    const stats = (
      await admin.request('GET', `/v1/admin/users/${ana.userId}/contract-stats`)
    ).json<{
      asFreelancer: { contracts: number; abandonments: number };
    }>();
    expect(stats.asFreelancer).toMatchObject({ contracts: 1, abandonments: 1 });
  });

  it('lets the mediation declare an abandonment', async () => {
    const { client, contractId } = await m.activeContract();
    const path = `/v1/admin/contracts/${contractId}/abandonment`;
    const body = { description: 'O dev não responde há 15 dias e não fez nenhuma entrega.' };
    expect((await post(client, path, body)).statusCode).toBe(403);
    expect((await admin.request('POST', path, { body })).statusCode).toBe(204);
    expect(await view(client, contractId)).toMatchObject({
      status: 'DISPUTED',
      dispute: { kind: 'ABANDONMENT' },
    });
    expect(t.mail.jobs.filter((job) => job.data.tag === 'contracts.dispute-opened').length).toBe(2);
  });
});
