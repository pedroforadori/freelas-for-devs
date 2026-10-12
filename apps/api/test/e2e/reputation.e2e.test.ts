import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { queueEntries } from '../../src/db/schema/distribution.js';
import { outboxEvents } from '../../src/db/schema/outbox.js';
import { UpdateQueueScore } from '../../src/modules/distribution/application/use-cases.js';
import { RecomputeReputation } from '../../src/modules/reputation/application/use-cases.js';
import { marketplace, type Person } from '../support/marketplace.js';
import {
  type BrowserSession,
  createAdminSession,
  createTestApp,
  type TestApp,
} from '../support/test-app.js';

let t: TestApp;
let admin: BrowserSession;
let m: ReturnType<typeof marketplace>;

interface ReputationView {
  level: { slug: string } | null;
  stats: {
    completedContracts: number;
    ratingAvg: number | null;
    onTimeRate: number | null;
    score: number;
  };
  progress: {
    nextLevel: { slug: string };
    automatic: boolean;
    eligible: boolean;
    criteria: { criterion: string; met: boolean }[];
  } | null;
  levelHistory: { from: string | null; to: string; automatic: boolean; reason: string }[];
}

const reputation = async (person: Person) =>
  (await person.browser.request('GET', '/v1/me/reputation')).json<ReputationView>();

const easyRule = (automatic: boolean) => ({
  promotion: {
    minCompleted: 1,
    minRatingAvg: 4,
    minOnTimeRate: 0.5,
    minScore: 0.5,
    maxAbandonments: 0,
    automatic,
  },
});

/** Contrato pago, entregue no prazo, aprovado e avaliado com nota 5. */
const completedContract = async () => {
  const scenario = await m.activeContract();
  const { ana, client, contractId } = scenario;
  await ana.browser.request('POST', `/v1/contracts/${contractId}/deliveries`, {
    body: { message: 'Entrega completa com todas as páginas. Teste pelo link.' },
  });
  await client.browser.request('POST', `/v1/contracts/${contractId}/review`, {
    body: { decision: 'APPROVE' },
  });
  await client.browser.request('POST', `/v1/contracts/${contractId}/rating`, {
    body: { rating: 5, comment: 'Ótimo trabalho.' },
  });
  return scenario;
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

describe('reputation', () => {
  it('starts neutral, so a beginner is not penalized', async () => {
    const ana = await m.freelancer('Ana');
    const view = await reputation(ana);
    expect(view).toMatchObject({
      level: { slug: 'iniciante' },
      stats: { completedContracts: 0, ratingAvg: null, score: 0.5 },
      progress: { nextLevel: { slug: 'intermediario' }, automatic: true, eligible: false },
    });
  });

  it('promotes automatically when the level rule is met and records the history', async () => {
    const levels = (await admin.request('GET', '/v1/admin/levels')).json<{
      items: { level: { slug: string }; promotion: unknown; nextLevel: unknown }[];
    }>();
    expect(levels.items.map((item) => item.level.slug)).toEqual([
      'iniciante',
      'intermediario',
      'avancado',
      'especialista',
    ]);
    expect(levels.items.at(-1)).toMatchObject({ promotion: null, nextLevel: null });
    const rule = await admin.request('PUT', '/v1/admin/levels/iniciante/promotion', {
      body: easyRule(true),
    });
    expect(rule.statusCode).toBe(204);

    const { ana } = await completedContract();
    const result = (await admin.request('POST', '/v1/admin/reputation/recompute')).json<{
      promoted: number;
    }>();
    expect(result.promoted).toBe(1);

    const view = await reputation(ana);
    expect(view.level?.slug).toBe('intermediario');
    expect(view.stats).toMatchObject({ completedContracts: 1, ratingAvg: 5, onTimeRate: 1 });
    expect(view.stats.score).toBeGreaterThan(0.5);
    expect(view.levelHistory[0]).toMatchObject({
      from: 'iniciante',
      to: 'intermediario',
      automatic: true,
    });
    expect(view.levelHistory[0]!.reason).toContain('1 projeto concluído');
    expect(t.mail.jobs.some((job) => job.data.tag === 'profiles.level-changed')).toBe(true);

    // Recalcular de novo não promove outra vez (a regra do novo nível é mais exigente).
    expect(await t.app.get(RecomputeReputation).execute()).toMatchObject({ promoted: 0 });
  });

  it('lists eligible freelancers as suggestions when the rule is manual', async () => {
    await admin.request('PUT', '/v1/admin/levels/iniciante/promotion', { body: easyRule(false) });
    const { ana } = await completedContract();
    expect(await t.app.get(RecomputeReputation).execute()).toMatchObject({ promoted: 0 });
    const suggestions = (await admin.request('GET', '/v1/admin/reputation/suggestions')).json<{
      items: { userId: string; nextLevel: { slug: string } }[];
    }>();
    expect(suggestions.items).toEqual([
      expect.objectContaining({
        userId: ana.userId,
        nextLevel: { slug: 'intermediario', name: 'Intermediário', rank: 2 },
      }),
    ]);
    expect((await reputation(ana)).progress).toMatchObject({ eligible: true, automatic: false });
  });

  it('feeds the queue: the score changes the turn among non-priority freelancers', async () => {
    const ana = await m.freelancer('Ana');
    const bruno = await m.freelancer('Bruno');
    // Mesma vez de convite; só o desempenho diferencia.
    await t.database.db
      .update(queueEntries)
      .set({ lastInvitedAt: new Date('2026-10-01T12:00:00Z') })
      .where(inArray(queueEntries.userId, [ana.userId, bruno.userId]));
    await t.app.get(UpdateQueueScore).execute(ana.userId, 0.2);
    await t.app.get(UpdateQueueScore).execute(bruno.userId, 0.9);

    const queue = (await admin.request('GET', '/v1/admin/queue?levelSlug=iniciante')).json<{
      items: { userId: string; position: number; score: number }[];
    }>();
    expect(queue.items.map((item) => [item.userId, item.score])).toEqual([
      [bruno.userId, 0.9],
      [ana.userId, 0.2],
    ]);
  });

  it('publishes the new score for the queue only when it changes', async () => {
    await completedContract();
    await t.app.get(RecomputeReputation).execute();
    const events = await t.database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.type, 'reputation.ScoreChanged'));
    expect(events.length).toBeGreaterThan(0);
    await t.app.get(RecomputeReputation).execute();
    const again = await t.database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.type, 'reputation.ScoreChanged'));
    expect(again).toHaveLength(events.length);
  });

  it('shows the real track record (not the internal score) to the client', async () => {
    await admin.request('PUT', '/v1/admin/levels/iniciante/promotion', {
      body: { promotion: null },
    });
    const { ana } = await completedContract();
    await t.app.get(RecomputeReputation).execute();
    // Novo projeto (outro cliente) com a Ana convidada.
    const { client, projectId, invitationId } = await m.projectInDistribution({ freelancer: ana });
    await ana.browser.request('PUT', `/v1/invitations/${invitationId}/proposal`, {
      body: {
        amountCents: 300_000,
        deadlineDays: 20,
        message:
          'Faço de novo com a mesma qualidade, já conheço o padrão do seu negócio e o conteúdo.',
      },
    });
    const proposals = (
      await client.browser.request('GET', `/v1/projects/${projectId}/proposals`)
    ).json<{
      proposals: { freelancer: { reputation: unknown } }[];
    }>();
    expect(proposals.proposals[0]?.freelancer.reputation).toEqual({
      completedContracts: 1,
      ratingAvg: 5,
      ratingCount: 1,
    });
  });
});
