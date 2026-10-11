import type { AddressInfo } from 'node:net';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../../src/db/schema/audit.js';
import { RemoveSuspendedFreelancer } from '../../src/modules/distribution/application/use-cases.js';
import { GenerateEstimate } from '../../src/modules/projects/application/use-cases.js';
import { CONTACT_MASK } from '../../src/shared/kernel/contact-detector.js';
import { DESCRIPTION, marketplace, type Person } from '../support/marketplace.js';
import {
  BrowserSession,
  createAdminSession,
  createTestApp,
  type TestApp,
  WEB_ORIGIN,
} from '../support/test-app.js';

let t: TestApp;
let admin: BrowserSession;
let m: ReturnType<typeof marketplace>;

interface MessageView {
  id: string;
  body: string;
  masked: boolean;
  sender: { userId: string; role: string };
}

interface ConversationView {
  id: string;
  kind: string;
  unreadCount: number;
  participants: { userId: string | null; role: string }[];
}

const PROPOSAL_TEXT =
  'Faço o site em Next.js com painel simples para o cardápio. Já entreguei três sites parecidos ' +
  'e posso mostrar os links.';

const conversationOf = async (browser: BrowserSession, path: string) => {
  const response = await browser.request('GET', path);
  return { status: response.statusCode, body: response.json<ConversationView>() };
};

const send = async (browser: BrowserSession, conversationId: string, body: string) => {
  const response = await browser.request('POST', `/v1/conversations/${conversationId}/messages`, {
    body: { body },
  });
  return { status: response.statusCode, message: response.json<MessageView>() };
};

const messages = async (browser: BrowserSession, conversationId: string, query = '') =>
  (await browser.request('GET', `/v1/conversations/${conversationId}/messages${query}`)).json<{
    items: MessageView[];
    previousCursor: string | null;
  }>();

/** Cliente com projeto em escopo (estimativa pronta), como logo depois de publicar. */
const projectInScoping = async () => {
  const client = await m.register('CLIENT', 'Cliente');
  const created = await client.browser.request('POST', '/v1/projects', {
    body: { title: 'Site da padaria', type: 'SITE', description: DESCRIPTION, attachmentIds: [] },
  });
  const projectId = created.json<{ id: string }>().id;
  await t.app.get(GenerateEstimate).execute(projectId, 1);
  return { client, projectId };
};

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

describe('scoping conversation', () => {
  it('lets the client talk to the specialist team and tracks unread messages', async () => {
    const { client, projectId } = await projectInScoping();
    const opened = await conversationOf(client.browser, `/v1/projects/${projectId}/conversation`);
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ kind: 'SCOPING', unreadCount: 0 });
    expect(opened.body.participants.map((p) => p.role)).toEqual(['CLIENT', 'SPECIALIST']);
    const conversationId = opened.body.id;

    const sent = await send(client.browser, conversationId, 'O cardápio muda toda semana.');
    expect(sent.status).toBe(201);
    expect(sent.message).toMatchObject({ masked: false, sender: { role: 'CLIENT' } });

    // O especialista (Admin) vê a mesma conversa e responde.
    const adminView = await conversationOf(admin, `/v1/projects/${projectId}/conversation`);
    expect(adminView.body).toMatchObject({ id: conversationId, unreadCount: 1 });
    t.clock.advance(1000);
    await send(admin, conversationId, 'Certo! Vamos prever um painel para editar o cardápio.');

    const list = (await client.browser.request('GET', '/v1/conversations')).json<{
      items: ConversationView[];
    }>();
    expect(list.items).toMatchObject([{ id: conversationId, unreadCount: 1 }]);
    await client.browser.request('POST', `/v1/conversations/${conversationId}/read`);
    expect(
      (await conversationOf(client.browser, `/v1/projects/${projectId}/conversation`)).body
        .unreadCount,
    ).toBe(0);

    const page = await messages(client.browser, conversationId);
    expect(page.items.map((item) => item.sender.role)).toEqual(['CLIENT', 'SPECIALIST']);
  });

  it('pages older messages with a cursor', async () => {
    const { client, projectId } = await projectInScoping();
    const { id } = (await conversationOf(client.browser, `/v1/projects/${projectId}/conversation`))
      .body;
    for (const n of [1, 2, 3]) {
      await send(client.browser, id, `Mensagem ${n}`);
      t.clock.advance(1000);
    }
    const latest = await messages(client.browser, id, '?limit=2');
    expect(latest.items.map((item) => item.body)).toEqual(['Mensagem 2', 'Mensagem 3']);
    const older = await messages(client.browser, id, `?limit=2&cursor=${latest.previousCursor}`);
    expect(older).toMatchObject({ items: [{ body: 'Mensagem 1' }], previousCursor: null });
  });

  it('hides conversations from people who are not part of them', async () => {
    const { client, projectId } = await projectInScoping();
    const { id } = (await conversationOf(client.browser, `/v1/projects/${projectId}/conversation`))
      .body;
    const stranger = await m.register('CLIENT', 'Curioso');
    expect(
      (await stranger.browser.request('GET', `/v1/projects/${projectId}/conversation`)).statusCode,
    ).toBe(404);
    expect(
      (await stranger.browser.request('GET', `/v1/conversations/${id}/messages`)).statusCode,
    ).toBe(404);
    expect((await send(stranger.browser, id, 'oi')).status).toBe(404);
  });
});

describe('contact moderation', () => {
  it('masks contact details, warns repeat offenders and lets the admin audit the original', async () => {
    const { client, projectId } = await projectInScoping();
    const { id } = (await conversationOf(client.browser, `/v1/projects/${projectId}/conversation`))
      .body;

    const first = await send(client.browser, id, 'me chama no zap 11 98765-4321 que é mais rápido');
    expect(first.message.masked).toBe(true);
    expect(first.message.body).toContain(CONTACT_MASK);
    expect(first.message.body).not.toMatch(/98765|zap/);
    expect(t.mail.jobs.some((job) => job.data.tag === 'moderation.warning')).toBe(false);

    await send(client.browser, id, 'manda para cliente arroba gmail ponto com');
    const warnings = t.mail.jobs.filter((job) => job.data.tag === 'moderation.warning');
    expect(warnings.map((job) => job.data.to)).toEqual([client.email]);

    // Quem lê a conversa só vê o texto mascarado.
    const page = await messages(admin, id);
    expect(page.items.every((item) => item.masked && !/\d{4}|arroba/.test(item.body))).toBe(true);

    const violations = (await admin.request('GET', '/v1/admin/moderation/violations')).json<{
      items: { id: string; source: string; kinds: string[]; user: { recentViolations: number } }[];
    }>().items;
    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatchObject({
      source: 'CHAT',
      kinds: ['EMAIL'],
      user: { recentViolations: 2 },
    });

    expect(
      (
        await client.browser.request(
          'POST',
          `/v1/admin/moderation/violations/${violations[0]!.id}/reveal`,
        )
      ).statusCode,
    ).toBe(403);
    const revealed = await admin.request(
      'POST',
      `/v1/admin/moderation/violations/${violations[0]!.id}/reveal`,
    );
    expect(revealed.json()).toEqual({ originalText: 'manda para cliente arroba gmail ponto com' });
    const audits = await t.database.db.select().from(auditLog);
    expect(
      audits.some(
        (a) => a.action === 'admin.violation_revealed' && a.targetId === violations[0]!.id,
      ),
    ).toBe(true);
  });

  it('screens proposal messages too', async () => {
    const { ana, invitationId } = await m.projectInDistribution();
    await ana.browser.request('PUT', `/v1/invitations/${invitationId}/proposal`, {
      body: {
        amountCents: 300_000,
        deadlineDays: 25,
        message: `${PROPOSAL_TEXT} Me chama no whatsapp 11987654321.`,
      },
    });
    const { proposal } = (
      await ana.browser.request('GET', `/v1/invitations/${invitationId}`)
    ).json<{ proposal: { message: string } }>();
    expect(proposal.message).toContain(CONTACT_MASK);
    expect(proposal.message).not.toMatch(/11987654321|whatsapp/i);

    const violations = (await admin.request('GET', '/v1/admin/moderation/violations')).json<{
      items: { source: string; user: { userId: string } }[];
    }>().items;
    expect(violations).toMatchObject([{ source: 'PROPOSAL', user: { userId: ana.userId } }]);
  });

  it('suspends an account (no login, out of the queue) and reinstates it', async () => {
    const { ana, client, projectId, invitationId } = await m.projectInDistribution();
    const reason = 'Insistiu em passar o telefone depois do aviso.';

    expect(
      (
        await client.browser.request('POST', `/v1/admin/users/${ana.userId}/suspend`, {
          body: { reason },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await admin.request('POST', `/v1/admin/users/${ana.userId}/suspend`, {
          body: { reason },
        })
      ).statusCode,
    ).toBe(204);
    expect(t.mail.jobs.some((job) => job.data.tag === 'moderation.suspended')).toBe(true);

    const login = async (person: Person) => {
      const browser = await new BrowserSession(t.app).init();
      return browser.request('POST', '/v1/auth/login', {
        body: { email: person.email, password: 'uma senha bem longa' },
      });
    };
    expect((await login(ana)).statusCode).toBe(403);
    // A sessão aberta não renova mais (tokens de renovação revogados).
    expect((await ana.browser.request('POST', '/v1/auth/refresh')).statusCode).toBe(401);

    // O worker reage ao evento: o convite aberto é anulado e a vaga volta para a fila.
    await t.app.get(RemoveSuspendedFreelancer).execute(ana.userId);
    const distribution = (
      await admin.request('GET', `/v1/admin/projects/${projectId}/distribution`)
    ).json<{ invitations: { id: string; status: string }[] }>();
    expect(distribution.invitations.find((i) => i.id === invitationId)?.status).toBe('VOIDED');

    expect(
      (await admin.request('POST', `/v1/admin/users/${ana.userId}/reinstate`)).statusCode,
    ).toBe(204);
    expect((await login(ana)).statusCode).toBe(200);
    const audits = await t.database.db.select().from(auditLog);
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['admin.user_suspended', 'admin.user_reinstated']),
    );
  });
});

describe('contract conversation', () => {
  it('opens after payment for the client and the hired freelancer only', async () => {
    const { ana, client, contractId } = await m.activeContract();
    const path = `/v1/contracts/${contractId}/conversation`;
    const opened = await conversationOf(client.browser, path);
    expect(opened.body.participants.map((p) => p.role)).toEqual(['CLIENT', 'FREELANCER']);
    expect((await conversationOf(ana.browser, path)).body.id).toBe(opened.body.id);
    expect((await conversationOf(admin, path)).status).toBe(200);

    const sent = await send(ana.browser, opened.body.id, 'Comecei pelo layout da home.');
    expect(sent.message.sender.role).toBe('FREELANCER');

    const other = await m.register('FREELANCER', 'Bruno');
    expect((await conversationOf(other.browser, path)).status).toBe(404);
  });
});

describe('realtime (Socket.IO)', () => {
  let url: string;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    await t.app.listen(0, '127.0.0.1');
    const { port } = t.app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}/chat`;
  });

  afterAll(() => {
    for (const socket of sockets) socket.disconnect();
  });

  const connect = (browser: BrowserSession | null, origin = WEB_ORIGIN) => {
    const cookie = browser
      ? [...browser.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
      : '';
    const socket = io(url, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { origin, ...(cookie ? { cookie } : {}) },
    });
    sockets.push(socket);
    return new Promise<ClientSocket>((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  };

  const join = (socket: ClientSocket, conversationId: string) =>
    socket.emitWithAck('conversation:join', { conversationId }) as Promise<{ ok: boolean }>;

  it('delivers new messages to participants that joined the room', async () => {
    const { client, projectId } = await projectInScoping();
    const { id } = (await conversationOf(client.browser, `/v1/projects/${projectId}/conversation`))
      .body;
    const socket = await connect(client.browser);
    expect(await join(socket, id)).toEqual({ ok: true });

    const received = new Promise<MessageView>((resolve) => socket.once('message:new', resolve));
    await send(admin, id, 'Me passa seu zap? brincadeira, aqui é o especialista.');
    const message = await received;
    expect(message).toMatchObject({
      masked: true,
      sender: { role: 'SPECIALIST', displayName: 'Especialista Freelas 4 Devs' },
    });
    expect(message.body).toContain(CONTACT_MASK);
  });

  it('refuses unauthenticated sockets, foreign origins and rooms of other people', async () => {
    const { client, projectId } = await projectInScoping();
    const { id } = (await conversationOf(client.browser, `/v1/projects/${projectId}/conversation`))
      .body;
    await expect(connect(null)).rejects.toThrow('UNAUTHENTICATED');
    await expect(connect(client.browser, 'https://evil.example')).rejects.toThrow(
      'UNAUTHENTICATED',
    );

    const stranger = await m.register('CLIENT', 'Curioso');
    const socket = await connect(stranger.browser);
    expect(await join(socket, id)).toEqual({ ok: false });
    expect(await join(socket, 'not-a-uuid')).toEqual({ ok: false });
  });
});
