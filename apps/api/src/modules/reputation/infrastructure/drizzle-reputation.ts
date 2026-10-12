import type { PromotionRule } from '@f4d/contracts';
import { count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { levels } from '../../../db/schema/catalog.js';
import { contractRatings, contracts, deliveries, disputes } from '../../../db/schema/contracts.js';
import { invitations } from '../../../db/schema/distribution.js';
import { users } from '../../../db/schema/identity.js';
import { freelancerProfiles, levelChanges } from '../../../db/schema/profiles.js';
import { freelancerStats } from '../../../db/schema/reputation.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import {
  appendToOutbox,
  assignEventIds,
} from '../../../shared/infra/outbox/drizzle-outbox.store.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type {
  FreelancerSnapshot,
  LevelHistoryReader,
  LevelRecord,
  LevelRules,
  ReputationSource,
  StatsStore,
  StoredStats,
} from '../application/ports.js';
import { ReputationEvents } from '../domain/events.js';

const COMPLETED = sql`('APPROVED', 'RELEASED')`;
const STARTED = sql`('ACTIVE', 'DISPUTED', 'APPROVED', 'RELEASED', 'SETTLED')`;

interface SourceRow {
  user_id: string;
  display_name: string;
  level_slug: string;
  [key: string]: unknown;
}

/**
 * Contagens por freelancer direto das tabelas de contratos, avaliações, convites e disputas.
 * "No prazo" = a última entrega do contrato concluído chegou até o prazo combinado (que já inclui
 * pausas e adicionais).
 */
export class DrizzleReputationSource implements ReputationSource {
  constructor(private readonly ctx: DatabaseContext) {}

  async freelancers(userIds?: readonly string[]): Promise<FreelancerSnapshot[]> {
    if (userIds?.length === 0) return [];
    const c = contracts;
    const result = await this.ctx.executor.execute<SourceRow>(sql`
      select u.id as user_id, u.display_name, fp.level_slug,
        (select count(*) from ${c} where ${c.freelancerId} = u.id and ${c.status} in ${COMPLETED}) as completed,
        (select count(*) from ${c} where ${c.freelancerId} = u.id and ${c.status} in ${STARTED}) as started,
        (select count(*) from ${contractRatings} r where r.freelancer_id = u.id) as rating_count,
        (select coalesce(sum(r.rating), 0) from ${contractRatings} r where r.freelancer_id = u.id) as rating_sum,
        (select count(*) from ${c}
          where ${c.freelancerId} = u.id and ${c.status} in ${COMPLETED} and ${c.dueAt} is not null
            and (select max(d.submitted_at) from ${deliveries} d where d.contract_id = ${c.id}) <= ${c.dueAt}
        ) as on_time,
        (select count(*) from ${disputes} ds join ${c} on ${c.id} = ds.contract_id
          where ${c.freelancerId} = u.id and ds.kind = 'ABANDONMENT') as abandonments,
        (select count(*) from ${invitations} i
          where i.freelancer_id = u.id and i.status not in ('INVITED', 'EXPIRED', 'VOIDED')) as answered,
        (select count(*) from ${invitations} i
          where i.freelancer_id = u.id and i.status = 'EXPIRED') as expired
      from ${users} u
      join ${freelancerProfiles} fp on fp.user_id = u.id
      where fp.status = 'APPROVED' and fp.level_slug is not null
        ${
          userIds
            ? sql`and u.id in (${sql.join(
                userIds.map((id) => sql`${id}`),
                sql`, `,
              )})`
            : sql``
        }
      order by u.id
    `);
    return result.rows.map((row) => ({
      userId: row.user_id,
      displayName: String(row.display_name),
      levelSlug: String(row.level_slug),
      raw: {
        completedContracts: Number(row.completed),
        startedContracts: Number(row.started),
        ratingCount: Number(row.rating_count),
        ratingSum: Number(row.rating_sum),
        onTimeContracts: Number(row.on_time),
        abandonments: Number(row.abandonments),
        invitationsAnswered: Number(row.answered),
        invitationsExpired: Number(row.expired),
      },
    }));
  }
}

export class DrizzleStatsStore implements StatsStore {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  async find(userId: string): Promise<StoredStats | null> {
    return (await this.findMany([userId])).get(userId) ?? null;
  }

  async findMany(userIds: readonly string[]): Promise<Map<string, StoredStats>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.ctx.executor
      .select()
      .from(freelancerStats)
      .where(inArray(freelancerStats.userId, [...userIds]));
    return new Map(
      rows.map((row) => [
        row.userId,
        {
          userId: row.userId,
          completedContracts: row.completedContracts,
          startedContracts: row.startedContracts,
          ratingCount: row.ratingCount,
          ratingSum: row.ratingSum,
          onTimeContracts: row.onTimeContracts,
          abandonments: row.abandonments,
          invitationsAnswered: row.invitationsAnswered,
          invitationsExpired: row.invitationsExpired,
          score: row.score,
          components: row.components,
          computedAt: row.computedAt,
        },
      ]),
    );
  }

  save(stats: StoredStats, scoreChanged: boolean): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.executor;
      const { userId, onTimeContracts, ...values } = stats;
      const row = { ...values, onTimeContracts };
      await db
        .insert(freelancerStats)
        .values({ userId, ...row })
        .onConflictDoUpdate({ target: freelancerStats.userId, set: row });
      if (!scoreChanged) return;
      await appendToOutbox(
        db,
        assignEventIds(
          [
            {
              type: ReputationEvents.ScoreChanged,
              aggregateType: 'FreelancerStats',
              aggregateId: userId,
              occurredAt: stats.computedAt,
              payload: { userId, score: stats.score },
            },
          ],
          this.ids,
        ),
      );
    });
  }
}

export class DrizzleLevelRules implements LevelRules {
  constructor(private readonly ctx: DatabaseContext) {}

  async list(): Promise<LevelRecord[]> {
    return this.ctx.executor.select().from(levels).orderBy(levels.rank);
  }

  async update(slug: string, promotion: PromotionRule | null): Promise<boolean> {
    const updated = await this.ctx.executor
      .update(levels)
      .set({ promotion })
      .where(eq(levels.slug, slug))
      .returning({ slug: levels.slug });
    return updated.length > 0;
  }

  async countByLevel(): Promise<Map<string, number>> {
    const rows = await this.ctx.executor
      .select({ slug: freelancerProfiles.levelSlug, total: count() })
      .from(freelancerProfiles)
      .where(isNotNull(freelancerProfiles.levelSlug))
      .groupBy(freelancerProfiles.levelSlug);
    return new Map(rows.map((row) => [row.slug!, row.total]));
  }
}

export class DrizzleLevelHistoryReader implements LevelHistoryReader {
  constructor(private readonly ctx: DatabaseContext) {}

  async list(userId: string) {
    const levelName = (slug: typeof levelChanges.fromLevel | typeof levelChanges.toLevel) =>
      sql<string | null>`(select l.name from ${levels} l where l.slug = ${slug})`;
    const rows = await this.ctx.executor
      .select({
        fromLevel: levelChanges.fromLevel,
        toLevel: levelChanges.toLevel,
        fromName: levelName(levelChanges.fromLevel),
        toName: levelName(levelChanges.toLevel),
        reason: levelChanges.reason,
        changedBy: levelChanges.changedBy,
        createdAt: levelChanges.createdAt,
      })
      .from(levelChanges)
      .where(eq(levelChanges.userId, userId))
      .orderBy(desc(levelChanges.createdAt));
    return rows.map((row) => ({
      from: row.fromLevel,
      to: row.toLevel,
      fromName: row.fromName,
      toName: row.toName ?? row.toLevel,
      reason: row.reason,
      changedBy: row.changedBy,
      createdAt: row.createdAt,
    }));
  }
}
