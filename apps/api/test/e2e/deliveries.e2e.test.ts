import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ProcessReviewDeadlines,
  ReleasePayment,
  RetryPendingReleases,
} from '../../src/modules/contracts/application/use-cases.js';
import { PAYMENT_GATEWAY } from '../../src/modules/contracts/contracts.module.js';
import type { FakePaymentGateway } from '../../src/modules/contracts/infrastructure/fake-gateway.js';
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
  work: {
    stage: string | null;
    correctionsLeft: number;
    reviewDeadlineAt: string | null;
    approvedAutomatically: boolean;
    deliveries: {
      number: number;
      outcome: string | null;
      attachments: { id: string }[];
      adjustments: { id: string; text: string }[];
    }[];
    rating: { rating: number } | null;
  };
}

const view = async (person: Person, contractId: string) =>
  (await person.browser.request('GET', `/v1/contracts/${contractId}`)).json<ContractView>();

const deliver = (person: Person, contractId: string, body: Record<string, unknown> = {}) =>
  person.browser.request('POST', `/v1/contracts/${contractId}/deliveries`, {
    body: { message: 'Entrega com as páginas prontas. Teste pelo link.', ...body },
  });

const review = (person: Person, contractId: string, body: Record<string, unknown>) =>
  person.browser.request('POST', `/v1/contracts/${contractId}/review`, { body });

const projectStatus = async (client: Person, projectId: string) =>
  (await client.browser.request('GET', `/v1/projects/${projectId}`)).json<{ status: string }>()
    .status;

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
  admin = await createAdminSession(t);
});

afterAll(async () => {
  await t?.close();
});

describe('delivery rounds', () => {
  it('goes through three deliveries, approval, payout and rating', async () => {
    const { ana, client, contractId, projectId } = await m.activeContract();
    expect((await view(client, contractId)).work.stage).toBe('WORKING_D1');

    // 1ª entrega com arquivo: o cliente passa a poder baixá-lo; um estranho, não.
    const fileId = await m.upload(ana, 'DELIVERY_FILE', 'layout.pdf');
    const first = await deliver(ana, contractId, {
      links: ['https://padaria-preview.vercel.app'],
      attachmentIds: [fileId],
    });
    expect(first.statusCode).toBe(201);
    expect(first.json<ContractView>().work).toMatchObject({
      stage: 'REVIEW_D1',
      deliveries: [{ number: 1, attachments: [{ id: fileId }] }],
    });
    expect((await client.browser.request('GET', `/v1/files/${fileId}/download`)).statusCode).toBe(
      200,
    );
    const stranger = await m.register('CLIENT', 'Estranho');
    expect((await stranger.browser.request('GET', `/v1/files/${fileId}`)).statusCode).toBe(404);
    expect(t.mail.jobs.some((job) => job.data.tag === 'contracts.delivery-submitted')).toBe(true);

    await review(client, contractId, { decision: 'ADJUSTMENTS', items: ['Trocar a cor do botão'] });
    expect((await view(ana, contractId)).work.stage).toBe('WORKING_D2');
    await deliver(ana, contractId);
    await review(client, contractId, { decision: 'ADJUSTMENTS', items: ['Ajustar o rodapé'] });
    await deliver(ana, contractId);
    expect((await view(client, contractId)).work.stage).toBe('FINAL_REVIEW');

    const approved = await review(client, contractId, { decision: 'APPROVE' });
    expect(approved.json()).toMatchObject({ status: 'APPROVED', work: { stage: null } });
    expect(await projectStatus(client, projectId)).toBe('COMPLETED');

    // O worker recebe ContractApproved: sem conta de recebimento, o repasse espera.
    expect(await t.app.get(ReleasePayment).execute(contractId)).toBe('WAITING_ACCOUNT');
    await ana.browser.request('POST', '/v1/me/payout-account/onboarding');
    expect(await t.app.get(RetryPendingReleases).execute()).toBe(1);
    expect((await view(ana, contractId)).status).toBe('RELEASED');
    expect(gateway.transfers).toEqual([
      expect.objectContaining({ amountCents: 270_000, contractId }),
    ]);
    expect(t.mail.jobs.at(-1)?.data.tag).toBe('contracts.released');

    const ledger = (await admin.request('GET', `/v1/admin/projects/${projectId}/contract`)).json<{
      escrowBalanceCents: number;
      ledger: { kind: string; account: string; debitCents: number; creditCents: number }[];
    }>();
    expect(ledger.escrowBalanceCents).toBe(0);
    expect(
      ledger.ledger
        .filter((entry) => entry.kind !== 'FUNDING')
        .map((entry) => [entry.kind, entry.account, entry.debitCents, entry.creditCents]),
    ).toEqual([
      ['RELEASE', 'ESCROW', 300_000, 0],
      ['RELEASE', 'FREELANCER_PAYABLE', 0, 270_000],
      ['RELEASE', 'PLATFORM_REVENUE', 0, 30_000],
      ['PAYOUT', 'FREELANCER_PAYABLE', 270_000, 0],
      ['PAYOUT', 'GATEWAY_CLEARING', 0, 270_000],
    ]);

    const rated = await client.browser.request('POST', `/v1/contracts/${contractId}/rating`, {
      body: { rating: 5, comment: 'Entregou antes do prazo.' },
    });
    expect(rated.json<ContractView>().work.rating).toMatchObject({ rating: 5 });
    expect(
      (
        await client.browser.request('POST', `/v1/contracts/${contractId}/rating`, {
          body: { rating: 1 },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('advances on review timeouts and auto-approves the final delivery', async () => {
    const { ana, client, contractId, projectId } = await m.activeContract();
    await deliver(ana, contractId);
    t.clock.advance(4 * DAY);
    expect(await t.app.get(ProcessReviewDeadlines).execute()).toBe(0);
    t.clock.advance(1 * DAY + 1000);
    expect(await t.app.get(ProcessReviewDeadlines).execute()).toBe(1);
    expect((await view(ana, contractId)).work).toMatchObject({
      stage: 'WORKING_D2',
      deliveries: [{ outcome: 'TIMEOUT', adjustments: [] }],
    });
    expect(t.mail.jobs.at(-1)?.data.tag).toBe('contracts.delivery-timeout');

    await deliver(ana, contractId);
    t.clock.advance(5 * DAY + 1000);
    await t.app.get(ProcessReviewDeadlines).execute();
    await deliver(ana, contractId);
    t.clock.advance(7 * DAY + 1000);
    await t.app.get(ProcessReviewDeadlines).execute();

    expect(await view(client, contractId)).toMatchObject({
      status: 'APPROVED',
      work: { approvedAutomatically: true },
    });
    expect(await projectStatus(client, projectId)).toBe('COMPLETED');
  });

  it('allows one correction of an adjustment already requested', async () => {
    const { ana, client, contractId } = await m.activeContract();
    await deliver(ana, contractId);
    await review(client, contractId, { decision: 'ADJUSTMENTS', items: ['Trocar a cor do botão'] });
    await deliver(ana, contractId);
    await review(client, contractId, { decision: 'ADJUSTMENTS', items: ['Ajustar o rodapé'] });
    await deliver(ana, contractId);
    const adjustment = (await view(client, contractId)).work.deliveries[0]!.adjustments[0]!;

    const unknown = await review(client, contractId, {
      decision: 'CORRECTION',
      adjustmentIds: ['01a00000-0000-7000-8000-000000000000'],
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ detail: expect.stringContaining('fora de escopo') });

    const corrected = await review(client, contractId, {
      decision: 'CORRECTION',
      adjustmentIds: [adjustment.id],
      note: 'O botão continua azul no celular.',
    });
    expect(corrected.json<ContractView>().work).toMatchObject({
      stage: 'WORKING_FINAL',
      correctionsLeft: 0,
    });
    expect(t.mail.jobs.at(-1)?.data.tag).toBe('contracts.delivery-correction');
    await deliver(ana, contractId);
    const again = await review(client, contractId, {
      decision: 'CORRECTION',
      adjustmentIds: [adjustment.id],
    });
    expect(again.json()).toMatchObject({ status: 400, detail: expect.stringContaining('limite') });
  });

  it('keeps each side to its own actions', async () => {
    const { ana, client, contractId } = await m.activeContract();
    expect((await deliver(client, contractId)).statusCode).toBe(403);
    expect((await review(ana, contractId, { decision: 'APPROVE' })).statusCode).toBe(403);
    expect((await review(client, contractId, { decision: 'APPROVE' })).statusCode).toBe(400);

    const other = await m.freelancer('Outra');
    expect((await deliver(other, contractId)).statusCode).toBe(404);
    const foreignFile = await m.upload(other, 'DELIVERY_FILE');
    expect((await deliver(ana, contractId, { attachmentIds: [foreignFile] })).statusCode).toBe(400);
  });

  it('lets invited freelancers read the project attachments', async () => {
    const { ana, attachmentIds } = await m.projectInDistribution({ attachments: true });
    expect((await ana.browser.request('GET', `/v1/files/${attachmentIds[0]}`)).statusCode).toBe(
      200,
    );
    const outsider = await m.register('FREELANCER', 'Fora');
    expect(
      (await outsider.browser.request('GET', `/v1/files/${attachmentIds[0]}`)).statusCode,
    ).toBe(404);
  });
});
