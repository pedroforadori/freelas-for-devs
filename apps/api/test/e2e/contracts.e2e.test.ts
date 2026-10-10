import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CancelContractForProject,
  CreateContractForSelection,
  ExpireUnpaidContracts,
} from '../../src/modules/contracts/application/use-cases.js';
import { PAYMENT_GATEWAY } from '../../src/modules/contracts/contracts.module.js';
import type { FakePaymentGateway } from '../../src/modules/contracts/infrastructure/fake-gateway.js';
import {
  FinalizeHiring,
  OpenRound,
  RevertSelection,
  SyncQueueEntry,
} from '../../src/modules/distribution/application/use-cases.js';
import { GenerateEstimate } from '../../src/modules/projects/application/use-cases.js';
import {
  BrowserSession,
  createAdminSession,
  createTestApp,
  type TestApp,
} from '../support/test-app.js';

let t: TestApp;
let admin: BrowserSession;
let gateway: FakePaymentGateway;
let counter = 0;

const HOUR = 60 * 60 * 1000;
const DESCRIPTION =
  'Site institucional para a padaria do bairro, com cardápio, fotos dos produtos, horário de ' +
  'funcionamento, mapa e um formulário de contato para encomendas de bolos.';
const MESSAGE =
  'Faço o site em Next.js com painel simples para o cardápio. Já entreguei três sites parecidos ' +
  'e posso mostrar os links. Entrego em etapas para você acompanhar.';

interface Person {
  browser: BrowserSession;
  userId: string;
  email: string;
}

const register = async (role: 'CLIENT' | 'FREELANCER', name: string): Promise<Person> => {
  await t.redis.flushall();
  const browser = await new BrowserSession(t.app).init();
  const email = `contrato${(counter += 1)}@exemplo.com`;
  await browser.request('POST', '/v1/auth/register', {
    body: { email, password: 'uma senha bem longa', displayName: name, role, acceptTerms: true },
  });
  const { id } = (await browser.request('GET', '/v1/me')).json<{ id: string }>();
  return { browser, userId: id, email };
};

const freelancer = async (name: string): Promise<Person> => {
  const person = await register('FREELANCER', name);
  await person.browser.request('PUT', '/v1/me/freelancer-profile', {
    body: {
      headline: `Dev ${name} para sites`,
      bio: 'Desenvolvo sites rápidos e acessíveis, com foco em pequenos negócios. '.repeat(3),
      stacks: ['react'],
      projectTypes: ['SITE'],
      links: { github: 'https://github.com/dev' },
      available: true,
    },
  });
  await person.browser.request('POST', '/v1/me/freelancer-profile/submit');
  await admin.request('POST', `/v1/admin/freelancers/${person.userId}/approve`, {
    body: { levelSlug: 'iniciante' },
  });
  await t.app.get(SyncQueueEntry).execute(person.userId, 'iniciante');
  t.clock.advance(1000);
  return person;
};

/** Projeto com duas propostas (Ana R$ 3.000 e Bia R$ 2.800) e a de Ana escolhida. */
const hiring = async () => {
  const [ana, bia] = [await freelancer('Ana'), await freelancer('Bia')];
  const client = await register('CLIENT', 'Cliente');
  const created = await client.browser.request('POST', '/v1/projects', {
    body: { title: 'Site da padaria', type: 'SITE', description: DESCRIPTION },
  });
  const projectId = created.json<{ id: string }>().id;
  await t.app.get(GenerateEstimate).execute(projectId, 1);
  await admin.request('PUT', `/v1/admin/projects/${projectId}/scope`, {
    body: {
      type: 'SITE',
      objective: 'Site institucional da padaria com cardápio e contato.',
      features: ['Cardápio'],
      acceptanceCriteria: ['Site publicado'],
      levelSlug: 'iniciante',
      priceRange: { minCents: 200_000, maxCents: 400_000 },
      deadlineDays: 30,
    },
  });
  await admin.request('POST', `/v1/admin/projects/${projectId}/approve`, { body: { version: 1 } });
  await t.app.get(OpenRound).execute(projectId);

  const invitationOf = async (person: Person) =>
    (await person.browser.request('GET', '/v1/me/invitations?view=open')).json<{
      items: { id: string }[];
    }>().items[0]!.id;
  const anaInvitation = await invitationOf(ana);
  const biaInvitation = await invitationOf(bia);
  for (const [person, invitationId, amountCents] of [
    [ana, anaInvitation, 300_000],
    [bia, biaInvitation, 280_000],
  ] as const) {
    await person.browser.request('PUT', `/v1/invitations/${invitationId}/proposal`, {
      body: { amountCents, deadlineDays: 25, message: MESSAGE },
    });
  }
  await client.browser.request('POST', `/v1/projects/${projectId}/selection`, {
    body: { invitationId: anaInvitation },
  });
  // O worker cria o contrato ao receber distribution.ProposalSelected.
  await t.app.get(CreateContractForSelection).execute({
    projectId,
    invitationId: anaInvitation,
    clientId: client.userId,
    freelancerId: ana.userId,
    amountCents: 300_000,
    deadlineDays: 25,
  });
  return { ana, bia, client, projectId, anaInvitation, biaInvitation };
};

const contractOf = async (person: Person, projectId: string) =>
  (await person.browser.request('GET', `/v1/projects/${projectId}/contract`)).json<{
    id: string;
    status: string;
    amounts: Record<string, number | string>;
    paymentInProgress: boolean;
  }>();

const checkout = async (client: Person, contractId: string) =>
  (await client.browser.request('POST', `/v1/contracts/${contractId}/checkout`)).json<{
    url: string;
  }>().url;

const checkoutIdOf = (url: string) => new URL(url).searchParams.get('checkout')!;

/** Webhook como o provedor envia: corpo cru assinado, sem cookies nem CSRF. */
const webhook = (event: Record<string, unknown>, signature = 'fake-webhook-secret') =>
  t.app.inject({
    method: 'POST',
    url: '/v1/webhooks/payments',
    headers: { 'content-type': 'application/json', 'x-fake-signature': signature },
    payload: JSON.stringify(event),
  });

const projectStatus = async (client: Person, projectId: string) =>
  (await client.browser.request('GET', `/v1/projects/${projectId}`)).json<{ status: string }>()
    .status;

const adminContract = async (projectId: string) =>
  (await admin.request('GET', `/v1/admin/projects/${projectId}/contract`)).json<{
    status: string;
    escrowBalanceCents: number;
    payments: { status: string }[];
    ledger: { kind: string; account: string; debitCents: number; creditCents: number }[];
  }>();

beforeAll(async () => {
  t = await createTestApp();
  gateway = t.app.get<FakePaymentGateway>(PAYMENT_GATEWAY);
});

beforeEach(async () => {
  await t.database.reset();
  await t.redis.flushall();
  t.mail.jobs.length = 0;
  gateway.refunds.length = 0;
  admin = await createAdminSession(t);
});

afterAll(async () => {
  await t?.close();
});

describe('hiring with escrow payment', () => {
  it('holds the payment in escrow once, starts the project and finalizes the queue', async () => {
    const { ana, bia, client, projectId } = await hiring();

    const contract = await contractOf(client, projectId);
    expect(contract).toMatchObject({
      status: 'AWAITING_PAYMENT',
      amounts: {
        proposalCents: 300_000,
        commissionBps: 1000,
        commissionPayer: 'FREELANCER',
        platformFeeCents: 30_000,
        clientTotalCents: 300_000,
        freelancerNetCents: 270_000,
      },
    });
    // O freelancer também vê o contrato.
    expect((await contractOf(ana, projectId)).id).toBe(contract.id);

    const url = await checkout(client, contract.id);
    expect(url).toContain('/pagamento-simulado?checkout=');
    // Voltar ao checkout reaproveita o mesmo, em vez de abrir outro.
    expect(await checkout(client, contract.id)).toBe(url);
    expect((await contractOf(client, projectId)).paymentInProgress).toBe(true);

    const event = {
      id: 'evt_1',
      type: 'payment.succeeded',
      checkoutId: checkoutIdOf(url),
      amountCents: 300_000,
    };
    expect((await webhook(event)).json()).toEqual({ received: true });
    // Reentrega do mesmo evento (o provedor faz isso) não gera efeito duplicado.
    expect((await webhook(event)).statusCode).toBe(200);

    expect((await contractOf(client, projectId)).status).toBe('FUNDED');
    expect(await projectStatus(client, projectId)).toBe('IN_PROGRESS');
    const view = await adminContract(projectId);
    expect(view.escrowBalanceCents).toBe(300_000);
    expect(view.ledger).toEqual([
      expect.objectContaining({
        kind: 'FUNDING',
        account: 'GATEWAY_CLEARING',
        debitCents: 300_000,
      }),
      expect.objectContaining({ kind: 'FUNDING', account: 'ESCROW', creditCents: 300_000 }),
    ]);
    expect(t.mail.jobs.map((job) => job.data.tag)).toEqual(
      expect.arrayContaining(['contracts.payment-confirmed', 'contracts.work-starts']),
    );

    // O worker recebe contracts.ContractFunded e fecha a rodada: Bia ganha prioridade.
    await t.app.get(FinalizeHiring).execute(projectId);
    expect((await bia.browser.request('GET', '/v1/me/queue')).json()).toMatchObject({
      tier: 'PRIORITY',
    });
  });

  it('rejects webhooks without a valid signature', async () => {
    const { client, projectId } = await hiring();
    const contract = await contractOf(client, projectId);
    const url = await checkout(client, contract.id);
    const forged = await webhook(
      {
        id: 'evt_x',
        type: 'payment.succeeded',
        checkoutId: checkoutIdOf(url),
        amountCents: 300_000,
      },
      'chute',
    );
    expect(forged.statusCode).toBe(400);
    expect((await contractOf(client, projectId)).status).toBe('AWAITING_PAYMENT');
  });

  it('expires an unpaid contract and lets the client choose again', async () => {
    const { client, projectId, biaInvitation } = await hiring();
    const contract = await contractOf(client, projectId);
    const url = await checkout(client, contract.id);

    t.clock.advance(71 * HOUR);
    expect(await t.app.get(ExpireUnpaidContracts).execute()).toBe(0);
    t.clock.advance(2 * HOUR);
    expect(await t.app.get(ExpireUnpaidContracts).execute()).toBe(1);
    expect((await contractOf(client, projectId)).status).toBe('EXPIRED');
    expect(gateway.expired.has(checkoutIdOf(url))).toBe(true);
    expect(
      (await client.browser.request('POST', `/v1/contracts/${contract.id}/checkout`)).statusCode,
    ).toBe(409);
    expect(t.mail.jobs.at(-1)?.data.tag).toBe('contracts.payment-expired');

    // O worker recebe contracts.ContractExpired: a escolha é desfeita.
    await t.app.get(RevertSelection).execute(projectId);
    expect(await projectStatus(client, projectId)).toBe('DISTRIBUTING');
    const proposals = (
      await client.browser.request('GET', `/v1/projects/${projectId}/proposals`)
    ).json<{ proposals: { invitationId: string; status: string }[] }>().proposals;
    expect(proposals.find((p) => p.invitationId === biaInvitation)?.status).toBe(
      'PROPOSAL_SUBMITTED',
    );
    const reselected = await client.browser.request('POST', `/v1/projects/${projectId}/selection`, {
      body: { invitationId: biaInvitation },
    });
    expect(reselected.statusCode).toBe(200);
  });

  it('refunds a payment confirmed after the contract closed', async () => {
    const { client, projectId } = await hiring();
    const contract = await contractOf(client, projectId);
    const url = await checkout(client, contract.id);

    // O cliente cancela; o checkout é fechado localmente — mas ele pagou segundos antes.
    await client.browser.request('POST', `/v1/projects/${projectId}/cancel`, { body: {} });
    await t.app.get(CancelContractForProject).execute(projectId);
    expect((await adminContract(projectId)).payments.map((p) => p.status)).toEqual(['EXPIRED']);

    await webhook({
      id: 'evt_late',
      type: 'payment.succeeded',
      checkoutId: checkoutIdOf(url),
      amountCents: 300_000,
    });

    const view = await adminContract(projectId);
    expect(view.status).toBe('CANCELLED');
    expect(view.payments.map((p) => p.status)).toEqual(['REFUNDED']);
    expect(view.escrowBalanceCents).toBe(0);
    expect([...new Set(view.ledger.map((l) => l.kind))]).toEqual(['FUNDING', 'REFUND']);
    expect(gateway.refunds).toEqual([
      expect.objectContaining({ amountCents: 300_000, paymentRef: `fake_pi_${checkoutIdOf(url)}` }),
    ]);
    expect(t.mail.jobs.at(-1)?.data.tag).toBe('contracts.late-payment-refunded');
    expect(await projectStatus(client, projectId)).toBe('CANCELLED');
  });

  it('adds the commission to the client total when the client pays it', async () => {
    await admin.request('PUT', '/v1/admin/settings/payments.commissionPayer', {
      body: { value: 'CLIENT', expectedVersion: 0 },
    });
    const { client, projectId } = await hiring();
    expect((await contractOf(client, projectId)).amounts).toMatchObject({
      clientTotalCents: 330_000,
      freelancerNetCents: 300_000,
    });
  });

  it('keeps contracts private and only lets the client pay', async () => {
    const { ana, client, projectId } = await hiring();
    const contract = await contractOf(client, projectId);
    const stranger = await register('CLIENT', 'Outro');
    expect((await stranger.browser.request('GET', `/v1/contracts/${contract.id}`)).statusCode).toBe(
      404,
    );
    expect(
      (await stranger.browser.request('POST', `/v1/contracts/${contract.id}/checkout`)).statusCode,
    ).toBe(404);
    expect(
      (await ana.browser.request('POST', `/v1/contracts/${contract.id}/checkout`)).statusCode,
    ).toBe(403);
  });

  it('simulates the checkout in development (fake provider only)', async () => {
    const { client, projectId } = await hiring();
    const contract = await contractOf(client, projectId);
    const url = await checkout(client, contract.id);
    const simulated = await client.browser.request('POST', '/v1/dev/payments/simulate', {
      body: { checkoutId: checkoutIdOf(url), outcome: 'succeeded' },
    });
    expect(simulated.statusCode).toBe(200);
    expect(await projectStatus(client, projectId)).toBe('IN_PROGRESS');
  });
});

describe('freelancer payout account', () => {
  it('creates the provider account and returns the onboarding link', async () => {
    const ana = await freelancer('Ana');
    expect((await ana.browser.request('GET', '/v1/me/payout-account')).json()).toEqual({
      exists: false,
      detailsSubmitted: false,
      payoutsEnabled: false,
    });
    const { url } = (await ana.browser.request('POST', '/v1/me/payout-account/onboarding')).json<{
      url: string;
    }>();
    expect(url).toBe('https://app.test/conta/recebimentos?retorno=1');
    expect((await ana.browser.request('GET', '/v1/me/payout-account')).json()).toEqual({
      exists: true,
      detailsSubmitted: true,
      payoutsEnabled: true,
    });
    const client = await register('CLIENT', 'Cliente');
    expect((await client.browser.request('GET', '/v1/me/payout-account')).statusCode).toBe(403);
  });
});
