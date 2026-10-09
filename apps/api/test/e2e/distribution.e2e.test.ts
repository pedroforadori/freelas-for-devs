import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CancelProjectRound,
  ExpireOverdueInvitations,
  FinalizeHiring,
  OpenRound,
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
  // Todos os cadastros saem do mesmo "IP" no teste: zera o limite de cadastros por IP.
  await t.redis.flushall();
  const browser = await new BrowserSession(t.app).init();
  const email = `fila${(counter += 1)}@exemplo.com`;
  await browser.request('POST', '/v1/auth/register', {
    body: { email, password: 'uma senha bem longa', displayName: name, role, acceptTerms: true },
  });
  const { id } = (await browser.request('GET', '/v1/me')).json<{ id: string }>();
  return { browser, userId: id, email };
};

/** Freelancer aprovado no nível e na fila (como o worker faz ao receber o evento de aprovação). */
const freelancer = async (
  name: string,
  options: { level?: string; types?: string[]; stacks?: string[] } = {},
): Promise<Person> => {
  const person = await register('FREELANCER', name);
  await person.browser.request('PUT', '/v1/me/freelancer-profile', {
    body: {
      headline: `Dev ${name} para sites e sistemas`,
      bio: 'Desenvolvo sites rápidos e acessíveis, com foco em pequenos negócios. '.repeat(3),
      stacks: options.stacks ?? ['react'],
      projectTypes: options.types ?? ['SITE'],
      links: { github: 'https://github.com/dev' },
      available: true,
    },
  });
  await person.browser.request('POST', '/v1/me/freelancer-profile/submit');
  const level = options.level ?? 'iniciante';
  await admin.request('POST', `/v1/admin/freelancers/${person.userId}/approve`, {
    body: { levelSlug: level },
  });
  await t.app.get(SyncQueueEntry).execute(person.userId, level);
  t.clock.advance(1000);
  return person;
};

/** Projeto publicado, estimado, com escopo aprovado e rodada aberta (evento ScopeApproved). */
const projectInDistribution = async (
  client: Person,
  scope: { levelSlug?: string; requiredStacks?: string[]; type?: string } = {},
) => {
  const created = await client.browser.request('POST', '/v1/projects', {
    body: { title: 'Site da padaria', type: scope.type ?? 'SITE', description: DESCRIPTION },
  });
  const { id } = created.json<{ id: string }>();
  await t.app.get(GenerateEstimate).execute(id, 1);
  await admin.request('PUT', `/v1/admin/projects/${id}/scope`, {
    body: {
      type: scope.type ?? 'SITE',
      objective: 'Site institucional da padaria com cardápio e contato.',
      features: ['Cardápio', 'Formulário de encomendas'],
      acceptanceCriteria: ['Site publicado no domínio do cliente'],
      requiredStacks: scope.requiredStacks ?? [],
      levelSlug: scope.levelSlug ?? 'iniciante',
      priceRange: { minCents: 200_000, maxCents: 400_000 },
      deadlineDays: 30,
    },
  });
  await admin.request('POST', `/v1/admin/projects/${id}/approve`, { body: { version: 1 } });
  await t.app.get(OpenRound).execute(id);
  return id;
};

const setting = (key: string, value: number) =>
  admin.request('PUT', `/v1/admin/settings/${key}`, { body: { value, expectedVersion: 0 } });

const openInvitations = async (person: Person) =>
  (await person.browser.request('GET', '/v1/me/invitations?view=open')).json<{
    items: { id: string; status: string; project: { id: string } }[];
  }>().items;

const queueOf = async (person: Person) =>
  (await person.browser.request('GET', '/v1/me/queue')).json<{
    position: number | null;
    tier: string;
    state: string;
    openInvitations: number;
  }>();

const projectStatus = async (client: Person, id: string) =>
  (await client.browser.request('GET', `/v1/projects/${id}`)).json<{ status: string }>().status;

const propose = (person: Person, invitationId: string, amountCents = 300_000) =>
  person.browser.request('PUT', `/v1/invitations/${invitationId}/proposal`, {
    body: { amountCents, deadlineDays: 25, message: MESSAGE },
  });

beforeAll(async () => {
  t = await createTestApp();
});

beforeEach(async () => {
  await t.database.reset();
  await t.redis.flushall();
  t.mail.jobs.length = 0;
  admin = await createAdminSession(t);
  await setting('queue.roundSize', 2);
});

afterAll(async () => {
  await t?.close();
});

describe('fair distribution queue', () => {
  it('invites the next eligible freelancers, refilling slots right away', async () => {
    const [ana, bia, caio, duda] = [
      await freelancer('Ana'),
      await freelancer('Bia'),
      await freelancer('Caio'),
      await freelancer('Duda'),
    ];
    const appOnly = await freelancer('Edu', { types: ['APP'] });
    const senior = await freelancer('Fabi', { level: 'avancado' });
    const client = await register('CLIENT', 'Cliente');

    const projectId = await projectInDistribution(client);
    expect(await projectStatus(client, projectId)).toBe('DISTRIBUTING');

    // K = 2: os dois primeiros da fila (nunca convidados, na ordem de chegada).
    const [anaInvite] = await openInvitations(ana);
    expect(anaInvite).toMatchObject({ status: 'INVITED', project: { id: projectId } });
    expect(await openInvitations(bia)).toHaveLength(1);
    for (const outside of [caio, appOnly, senior])
      expect(await openInvitations(outside)).toEqual([]);
    expect(t.mail.jobs.filter((job) => job.data.tag === 'distribution.invitation')).toHaveLength(2);

    // O convite mostra o escopo aprovado, sem o nível interno.
    const detail = (await ana.browser.request('GET', `/v1/invitations/${anaInvite!.id}`)).json<{
      project: { scope: Record<string, unknown> };
    }>();
    expect(detail.project.scope).toMatchObject({ priceRange: { minCents: 200_000 } });
    expect(detail.project.scope).not.toHaveProperty('levelSlug');

    // Ana recusa: perde a vez e a vaga vai na hora para o próximo (Caio).
    const declined = await ana.browser.request('POST', `/v1/invitations/${anaInvite!.id}/decline`);
    expect(declined.json()).toMatchObject({ status: 'DECLINED' });
    expect(await openInvitations(caio)).toHaveLength(1);
    expect(await openInvitations(duda)).toEqual([]);
    expect(await queueOf(ana)).toMatchObject({ tier: 'NORMAL', openInvitations: 0 });
    // Quem nunca foi convidado (Duda) passa à frente de quem acabou de recusar.
    expect((await queueOf(duda)).position).toBeLessThan((await queueOf(ana)).position!);
  });

  it('takes proposals within the approved range and lets the client choose with feedback', async () => {
    await setting('queue.roundsBeforeMonitoring', 5);
    const [ana, bia] = [await freelancer('Ana'), await freelancer('Bia')];
    const client = await register('CLIENT', 'Cliente');
    const projectId = await projectInDistribution(client);
    const [anaInvite] = await openInvitations(ana);
    const [biaInvite] = await openInvitations(bia);

    const outOfRange = await propose(ana, anaInvite!.id, 900_000);
    expect(outOfRange.statusCode).toBe(400);
    expect(outOfRange.json()).toMatchObject({ detail: expect.stringContaining('R$ 2.000') });
    expect((await propose(ana, anaInvite!.id)).json()).toMatchObject({
      status: 'PROPOSAL_SUBMITTED',
      proposal: { amountCents: 300_000 },
    });
    await propose(bia, biaInvite!.id, 250_000);
    // Editar antes da escolha não gera novo aviso ao cliente.
    await propose(bia, biaInvite!.id, 260_000);
    expect(t.mail.jobs.filter((job) => job.data.tag === 'distribution.new-proposal')).toHaveLength(
      2,
    );

    const proposals = (
      await client.browser.request('GET', `/v1/projects/${projectId}/proposals`)
    ).json<{
      awaitingResponses: number;
      proposals: {
        invitationId: string;
        amountCents: number;
        freelancer: { displayName: string; level: { slug: string } };
      }[];
    }>();
    expect(proposals.awaitingResponses).toBe(0);
    expect(proposals.proposals.map((p) => [p.freelancer.displayName, p.amountCents])).toEqual([
      ['Ana', 300_000],
      ['Bia', 260_000],
    ]);
    expect(proposals.proposals[0]?.freelancer.level.slug).toBe('iniciante');

    const selected = await client.browser.request('POST', `/v1/projects/${projectId}/selection`, {
      body: {
        invitationId: anaInvite!.id,
        feedback: [{ invitationId: biaInvite!.id, reasons: ['PORTFOLIO'] }],
      },
    });
    expect(
      selected.json<{ proposals: { status: string }[] }>().proposals.map((p) => p.status),
    ).toEqual(['SELECTED_PENDING_PAYMENT', 'ON_HOLD']);
    expect(await projectStatus(client, projectId)).toBe('HIRING');
    expect(t.mail.jobs.find((job) => job.data.tag === 'distribution.selected')?.data.to).toBe(
      ana.email,
    );
    // Depois da escolha, ninguém mais edita proposta.
    expect((await propose(bia, biaInvite!.id, 255_000)).statusCode).toBe(409);

    // Pagamento confirmado (F6): Ana contratada; Bia ganha prioridade na próxima rodada.
    await t.app.get(FinalizeHiring).execute(projectId);
    expect(await queueOf(bia)).toMatchObject({ tier: 'PRIORITY', position: 1 });
    expect(await queueOf(ana)).toMatchObject({ tier: 'NORMAL' });

    const distribution = (
      await admin.request('GET', `/v1/admin/projects/${projectId}/distribution`)
    ).json<{
      invitations: {
        freelancer: { displayName: string };
        status: string;
        feedback: string[] | null;
      }[];
    }>();
    expect(
      distribution.invitations.map((i) => [i.freelancer.displayName, i.status, i.feedback]),
    ).toEqual([
      ['Ana', 'HIRED', null],
      ['Bia', 'NOT_SELECTED', ['PORTFOLIO']],
    ]);
  });

  it('expires unanswered invitations and passes the slot on', async () => {
    const [ana, bia, caio] = [
      await freelancer('Ana'),
      await freelancer('Bia'),
      await freelancer('Caio'),
    ];
    const client = await register('CLIENT', 'Cliente');
    await projectInDistribution(client);
    const [biaInvite] = await openInvitations(bia);
    await propose(bia, biaInvite!.id);

    t.clock.advance(47 * HOUR);
    expect(await t.app.get(ExpireOverdueInvitations).execute()).toBe(0);
    t.clock.advance(2 * HOUR);
    expect(await t.app.get(ExpireOverdueInvitations).execute()).toBe(1);

    const anaHistory = (await ana.browser.request('GET', '/v1/me/invitations?view=history')).json<{
      items: { status: string }[];
    }>().items;
    expect(anaHistory.map((item) => item.status)).toEqual(['EXPIRED']);
    expect(await openInvitations(caio)).toHaveLength(1);
    // Proposta enviada não expira.
    expect((await openInvitations(bia))[0]?.status).toBe('PROPOSAL_SUBMITTED');
  });

  it('moves freelancers to monitoring after N rounds without selection, until reactivated', async () => {
    await setting('queue.roundsBeforeMonitoring', 1);
    const [ana, bia] = [await freelancer('Ana'), await freelancer('Bia')];
    const client = await register('CLIENT', 'Cliente');
    const projectId = await projectInDistribution(client);
    const [anaInvite] = await openInvitations(ana);
    const [biaInvite] = await openInvitations(bia);
    await propose(ana, anaInvite!.id);
    await propose(bia, biaInvite!.id);
    await client.browser.request('POST', `/v1/projects/${projectId}/selection`, {
      body: { invitationId: anaInvite!.id },
    });
    await t.app.get(FinalizeHiring).execute(projectId);

    expect(await queueOf(bia)).toMatchObject({ state: 'MONITORING', position: null });
    const monitoring = (await admin.request('GET', '/v1/admin/queue?state=MONITORING')).json<{
      items: { userId: string; roundsWithoutSelection: number }[];
    }>();
    expect(monitoring.items).toEqual([
      expect.objectContaining({ userId: bia.userId, roundsWithoutSelection: 1 }),
    ]);
    // Em acompanhamento, não recebe convites.
    await projectInDistribution(client);
    expect(await openInvitations(bia)).toHaveLength(0);

    const reactivated = await admin.request('POST', `/v1/admin/queue/${bia.userId}/reactivate`);
    expect(reactivated.json()).toMatchObject({ state: 'ACTIVE', tier: 'PRIORITY', position: 1 });
    expect(
      (await client.browser.request('POST', `/v1/admin/queue/${bia.userId}/reactivate`)).statusCode,
    ).toBe(403);
  });

  it('respects required stacks and reports an exhausted queue to the specialist', async () => {
    await freelancer('Ana', { stacks: ['react'] });
    const vue = await freelancer('Bia', { stacks: ['vue'] });
    const client = await register('CLIENT', 'Cliente');

    const vueProject = await projectInDistribution(client, { requiredStacks: ['vue'] });
    expect((await openInvitations(vue))[0]?.project.id).toBe(vueProject);

    const nobody = await projectInDistribution(client, { requiredStacks: ['flutter'] });
    expect(await projectStatus(client, nobody)).toBe('NO_CANDIDATES');
    // O especialista ajusta o escopo (reabre) e aprova de novo.
    expect(
      (await admin.request('POST', `/v1/admin/projects/${nobody}/reopen`)).json(),
    ).toMatchObject({
      status: 'SCOPING',
    });
  });

  it('limits open invitations per freelancer and never invites twice for a project', async () => {
    await setting('queue.maxOpenInvitesPerFreelancer', 1);
    const ana = await freelancer('Ana');
    const client = await register('CLIENT', 'Cliente');
    const first = await projectInDistribution(client);
    expect(await t.app.get(OpenRound).execute(first)).toBeNull();
    const second = await projectInDistribution(client);
    expect((await openInvitations(ana)).map((i) => i.project.id)).toEqual([first]);
    expect(await projectStatus(client, second)).toBe('NO_CANDIDATES');
  });

  it('gives priority back to proposers when the client cancels', async () => {
    const [ana, bia] = [await freelancer('Ana'), await freelancer('Bia')];
    const client = await register('CLIENT', 'Cliente');
    const projectId = await projectInDistribution(client);
    const [anaInvite] = await openInvitations(ana);
    await propose(ana, anaInvite!.id);

    await client.browser.request('POST', `/v1/projects/${projectId}/cancel`, { body: {} });
    await t.app.get(CancelProjectRound).execute(projectId);
    expect(await queueOf(ana)).toMatchObject({ tier: 'PRIORITY' });
    expect(await queueOf(bia)).toMatchObject({ tier: 'NORMAL', openInvitations: 0 });
    expect(await openInvitations(bia)).toEqual([]);
  });

  it('keeps invitations and proposals private', async () => {
    const [ana, bia] = [await freelancer('Ana'), await freelancer('Bia')];
    const client = await register('CLIENT', 'Cliente');
    const projectId = await projectInDistribution(client);
    const [anaInvite] = await openInvitations(ana);

    expect((await bia.browser.request('GET', `/v1/invitations/${anaInvite!.id}`)).statusCode).toBe(
      404,
    );
    expect((await propose(bia, anaInvite!.id)).statusCode).toBe(404);
    const otherClient = await register('CLIENT', 'Outro');
    expect(
      (await otherClient.browser.request('GET', `/v1/projects/${projectId}/proposals`)).statusCode,
    ).toBe(404);
    expect(
      (
        await ana.browser.request('POST', `/v1/projects/${projectId}/selection`, {
          body: { invitationId: anaInvite!.id },
        })
      ).statusCode,
    ).toBe(403);
  });
});
