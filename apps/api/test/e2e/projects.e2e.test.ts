import type { Level, Stack } from '@f4d/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { outboxEvents } from '../../src/db/schema/outbox.js';
import { aiEstimationRuns } from '../../src/db/schema/projects.js';
import type {
  EstimatorRun,
  ProjectEstimator,
} from '../../src/modules/projects/application/ports.js';
import {
  FailEstimate,
  GenerateEstimate,
} from '../../src/modules/projects/application/use-cases.js';
import type { EstimationBrief } from '../../src/modules/projects/domain/project.js';
import { HeuristicProjectEstimator } from '../../src/modules/projects/infrastructure/estimation/heuristic-estimator.js';
import { PROJECT_ESTIMATOR } from '../../src/modules/projects/projects.module.js';
import { ScanUploadedFile } from '../../src/modules/files/application/use-cases.js';
import {
  BrowserSession,
  createAdminSession,
  createTestApp,
  type TestApp,
} from '../support/test-app.js';

/** Estimador heurístico que pode ser forçado a falhar (IA fora do ar). */
class ScriptedEstimator implements ProjectEstimator {
  readonly model = 'test-model';
  readonly promptVersion = 'test-v1';
  failing = false;
  readonly briefs: EstimationBrief[] = [];
  private readonly inner = new HeuristicProjectEstimator();

  estimate(brief: EstimationBrief, context: { levels: Level[]; stacks: Stack[] }) {
    this.briefs.push(brief);
    if (this.failing) return Promise.reject(new Error('overloaded_error'));
    return this.inner.estimate(brief, context).then((run): EstimatorRun => ({
      ...run,
      usage: { ...run.usage, model: this.model, inputTokens: 900, outputTokens: 250 },
    }));
  }
}

let t: TestApp;
let counter = 0;
const estimator = new ScriptedEstimator();

const DETAILED =
  'Preciso de uma loja virtual para vender roupas femininas, com catálogo por categorias, ' +
  'carrinho, pagamento com Pix e cartão, cálculo de frete e um painel para eu cadastrar produtos.';
const VAGUE =
  'Quero um aplicativo para o meu negócio de estética, algo moderno e fácil de usar no dia a dia.';

const register = async (role: 'CLIENT' | 'FREELANCER' = 'CLIENT') => {
  const browser = await new BrowserSession(t.app).init();
  const email = `projeto${(counter += 1)}@exemplo.com`;
  await browser.request('POST', '/v1/auth/register', {
    body: {
      email,
      password: 'uma senha bem longa',
      displayName: 'Ana Cliente',
      role,
      acceptTerms: true,
    },
  });
  return { browser, email };
};

const publish = (browser: BrowserSession, overrides: Record<string, unknown> = {}) =>
  browser.request('POST', '/v1/projects', {
    body: {
      title: 'Loja de roupas',
      type: 'ECOMMERCE',
      description: DETAILED,
      references: ['https://www.exemplo-de-loja.com.br'],
      desiredDeadline: 'UP_TO_3_MONTHS',
      ...overrides,
    },
  });

const generate = (projectId: string, round: number) =>
  t.app.get(GenerateEstimate).execute(projectId, round);

beforeAll(async () => {
  t = await createTestApp({}, { overrides: [{ token: PROJECT_ESTIMATOR, value: estimator }] });
});

beforeEach(async () => {
  await t.database.reset();
  await t.redis.flushall();
  estimator.failing = false;
  t.mail.jobs.length = 0;
});

afterAll(async () => {
  await t?.close();
});

describe('publishing a project', () => {
  it('estimates in the background and shows the client only the client-facing estimate', async () => {
    const { browser, email } = await register();
    const created = await publish(browser);
    expect(created.statusCode).toBe(201);
    const project = created.json<{ id: string; status: string }>();
    expect(project).toMatchObject({ status: 'ESTIMATING', estimate: null, attachments: [] });

    // A publicação e o pedido de estimativa são gravados juntos (outbox).
    const events = await t.database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, project.id));
    expect(events.map((e) => e.type)).toEqual(['projects.ProjectSubmitted']);
    expect(events[0]?.payload).toMatchObject({ round: 1 });

    expect(await generate(project.id, 1)).toBe('estimate');
    // Job repetido (entrega at-least-once) não chama a IA de novo.
    expect(await generate(project.id, 1)).toBe('skipped');
    expect(estimator.briefs).toHaveLength(1);

    const shown = (await browser.request('GET', `/v1/projects/${project.id}`)).json<{
      status: string;
      estimate: Record<string, unknown>;
    }>();
    expect(shown.status).toBe('SCOPING');
    expect(shown.estimate).toMatchObject({
      priceRange: { minCents: expect.any(Number), maxCents: expect.any(Number) },
      durationDays: { min: expect.any(Number), max: expect.any(Number) },
    });
    // Sugestões internas (nível, stacks, notas) ficam só com o Admin.
    expect(shown.estimate).not.toHaveProperty('suggestedLevel');
    expect(shown.estimate).not.toHaveProperty('reviewNotes');

    const projectMails = t.mail.jobs.filter((job) => job.data.tag.startsWith('projects.'));
    expect(projectMails.map((job) => [job.data.to, job.data.tag])).toEqual([
      [email, 'projects.estimate-ready'],
    ]);
    const runs = await t.database.db
      .select()
      .from(aiEstimationRuns)
      .where(eq(aiEstimationRuns.projectId, project.id));
    expect(runs).toMatchObject([
      { outcome: 'ESTIMATE', model: 'test-model', inputTokens: 900, outputTokens: 250 },
    ]);
  });

  it('asks clarifying questions once and re-estimates with the answers', async () => {
    const { browser } = await register();
    const { id } = (await publish(browser, { type: 'APP', description: VAGUE })).json<{
      id: string;
    }>();

    expect(await generate(id, 1)).toBe('clarify');
    const waiting = (await browser.request('GET', `/v1/projects/${id}`)).json<{
      status: string;
      clarification: { questions: { id: string; options: { id: string }[] }[] };
    }>();
    expect(waiting.status).toBe('AWAITING_CLARIFICATION');
    expect(waiting.clarification.questions).toHaveLength(2);
    expect(t.mail.jobs.at(-1)?.data.tag).toBe('projects.clarification-needed');

    const answer = (answers: unknown) =>
      browser.request('POST', `/v1/projects/${id}/clarifications`, { body: { answers } });

    const incomplete = await answer([{ questionId: 'q1', optionId: 'b' }]);
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json()).toMatchObject({ detail: 'Responda todas as perguntas.' });
    expect((await answer([{ questionId: 'q1', optionId: 'b', other: 'x' }])).statusCode).toBe(400);

    const answered = await answer([
      { questionId: 'q1', optionId: 'b' },
      { questionId: 'q2', other: 'Sim, com Pix' },
    ]);
    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({
      status: 'ESTIMATING',
      clarification: { answers: [{ questionId: 'q1' }, { questionId: 'q2' }] },
    });

    // Um job atrasado da 1ª rodada é descartado; a 2ª rodada estima com as respostas.
    expect(await generate(id, 1)).toBe('skipped');
    expect(await generate(id, 2)).toBe('estimate');
    expect(estimator.briefs.at(-1)).toMatchObject({
      allowQuestions: false,
      clarifications: [
        { question: 'Quem vai usar o que será construído?', answer: 'Meus clientes' },
        { question: 'Vai precisar receber pagamentos online?', answer: 'Sim, com Pix' },
      ],
    });
    expect((await answer([{ questionId: 'q1', optionId: 'a' }])).statusCode).toBe(409);
  });

  it('hands the project to the specialist when the AI keeps failing', async () => {
    const { browser } = await register();
    const { id } = (await publish(browser)).json<{ id: string }>();

    estimator.failing = true;
    await expect(generate(id, 1)).rejects.toThrow('overloaded_error');
    expect(await t.app.get(FailEstimate).execute(id, 1)).toBe(true);
    expect(await t.app.get(FailEstimate).execute(id, 1)).toBe(false);

    expect((await browser.request('GET', `/v1/projects/${id}`)).json()).toMatchObject({
      status: 'SCOPING',
      estimate: null,
      estimateUnavailable: true,
    });
    const runs = await t.database.db
      .select()
      .from(aiEstimationRuns)
      .where(eq(aiEstimationRuns.projectId, id));
    expect(runs).toMatchObject([{ outcome: 'ERROR', error: 'overloaded_error' }]);
  });

  it('lets the client cancel, discarding a late estimate', async () => {
    const { browser } = await register();
    const { id } = (await publish(browser)).json<{ id: string }>();

    const cancelled = await browser.request('POST', `/v1/projects/${id}/cancel`, {
      body: { reason: 'Vou adiar o projeto' },
    });
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });
    expect(await generate(id, 1)).toBe('skipped');
    expect(
      (await browser.request('POST', `/v1/projects/${id}/cancel`, { body: {} })).statusCode,
    ).toBe(409);
  });

  it('lists the client projects, newest first, with keyset pagination', async () => {
    const { browser } = await register();
    for (const title of ['Primeiro projeto', 'Segundo projeto', 'Terceiro projeto']) {
      await publish(browser, { title });
      t.clock.advance(1000);
    }
    const first = (await browser.request('GET', '/v1/projects?limit=2')).json<{
      items: { title: string }[];
      nextCursor: string;
    }>();
    expect(first.items.map((p) => p.title)).toEqual(['Terceiro projeto', 'Segundo projeto']);
    const second = (
      await browser.request('GET', `/v1/projects?limit=2&cursor=${first.nextCursor}`)
    ).json<{ items: { title: string }[]; nextCursor: string | null }>();
    expect(second).toEqual({
      items: [expect.objectContaining({ title: 'Primeiro projeto' })],
      nextCursor: null,
    });
  });
});

describe('project rules and access control', () => {
  it('validates the draft with the shared contract', async () => {
    const { browser } = await register();
    const invalid = await publish(browser, {
      description: 'Curto demais',
      references: ['javascript:alert(1)'],
      budget: 10,
    });
    expect(invalid.statusCode).toBe(400);
    const paths = invalid.json<{ errors: { path: string }[] }>().errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['body.description', 'body.references.0']));
  });

  it('limits publications per day to contain AI cost and abuse', async () => {
    const { browser } = await register();
    for (let i = 0; i < 3; i += 1) expect((await publish(browser)).statusCode).toBe(201);
    const limited = await publish(browser);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('3600');

    t.clock.advance(25 * 60 * 60 * 1000);
    expect((await publish(browser)).statusCode).toBe(201);
  });

  it('keeps projects private to their client and closed to freelancers', async () => {
    const owner = await register();
    const { id } = (await publish(owner.browser)).json<{ id: string }>();

    const other = await register();
    expect((await other.browser.request('GET', `/v1/projects/${id}`)).statusCode).toBe(404);
    expect(
      (await other.browser.request('POST', `/v1/projects/${id}/cancel`, { body: {} })).statusCode,
    ).toBe(404);

    const freelancer = await register('FREELANCER');
    expect((await publish(freelancer.browser)).statusCode).toBe(403);
    const anonymous = await new BrowserSession(t.app).init();
    expect((await publish(anonymous)).statusCode).toBe(401);
  });

  it('accepts only the client own project attachments', async () => {
    const uploadAttachment = async (browser: BrowserSession) => {
      const pdf = new TextEncoder().encode('%PDF-1.7\n' + 'conteúdo '.repeat(20));
      const created = await browser.request('POST', '/v1/files/uploads', {
        body: {
          purpose: 'PROJECT_ATTACHMENT',
          fileName: 'briefing.pdf',
          contentType: 'application/pdf',
          size: pdf.length,
        },
      });
      const { file, upload } = created.json<{
        file: { id: string };
        upload: { url: string; headers: Record<string, string> };
      }>();
      t.storage.simulateUpload(upload.url, pdf, upload.headers['content-type']!);
      await browser.request('POST', `/v1/files/${file.id}/complete`);
      return file.id;
    };

    const { browser } = await register();
    const mine = await uploadAttachment(browser);
    const someoneElse = await uploadAttachment((await register()).browser);

    expect((await publish(browser, { attachmentIds: [someoneElse] })).statusCode).toBe(400);
    const created = await publish(browser, { attachmentIds: [mine] });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      attachments: [{ id: mine, fileName: 'briefing.pdf', status: 'SCANNING' }],
    });

    await t.app.get(ScanUploadedFile).execute(mine);
    const { id } = created.json<{ id: string }>();
    expect((await browser.request('GET', `/v1/projects/${id}`)).json()).toMatchObject({
      attachments: [{ id: mine, status: 'READY' }],
    });
  });
});

describe('admin project queue', () => {
  it('shows projects awaiting scope with the full estimate and AI usage', async () => {
    const client = await register();
    const { id } = (await publish(client.browser)).json<{ id: string }>();
    await generate(id, 1);

    const admin = await createAdminSession(t);
    const list = (await admin.request('GET', '/v1/admin/projects?status=SCOPING')).json<{
      items: { id: string; client: { email: string } }[];
    }>();
    expect(list.items).toEqual([
      expect.objectContaining({ id, client: expect.objectContaining({ email: client.email }) }),
    ]);

    const detail = (await admin.request('GET', `/v1/admin/projects/${id}`)).json();
    expect(detail).toMatchObject({
      estimate: { suggestedLevel: expect.any(String), complexity: 'MEDIUM' },
      aiRuns: [{ outcome: 'ESTIMATE', model: 'test-model', inputTokens: 900 }],
    });

    expect((await client.browser.request('GET', '/v1/admin/projects')).statusCode).toBe(403);
  });
});
