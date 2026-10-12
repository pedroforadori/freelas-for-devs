import type {
  AdminDistribution,
  AdminQueueEntry,
  InvitationStatus,
  MyQueueStatus,
  ProjectType,
  QueueState,
  QueueTier,
  Scope,
} from '@f4d/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  lt,
  lte,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { levels } from '../../../db/schema/catalog.js';
import { distributionRounds, invitations, queueEntries } from '../../../db/schema/distribution.js';
import { users } from '../../../db/schema/identity.js';
import {
  freelancerProfiles,
  freelancerStacks,
  portfolioItems,
} from '../../../db/schema/profiles.js';
import { projects } from '../../../db/schema/projects.js';
import { freelancerStats } from '../../../db/schema/reputation.js';
import type { SettingsReader } from '../../../shared/application/settings-reader.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import {
  appendToOutbox,
  assignEventIds,
} from '../../../shared/infra/outbox/drizzle-outbox.store.js';
import { ConcurrencyError } from '../../../shared/kernel/domain-error.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type {
  CandidateQuery,
  DistributionQueries,
  PeopleDirectory,
  QueueRepository,
  RoundRepository,
} from '../application/ports.js';
import type { InvitationProps } from '../domain/invitation.js';
import { QueueEntry } from '../domain/queue-entry.js';
import { DistributionRound } from '../domain/round.js';

/** Status em que o convite está "em aberto" para o freelancer. */
const OPEN_FOR_FREELANCER: InvitationStatus[] = [
  'INVITED',
  'PROPOSAL_SUBMITTED',
  'SELECTED_PENDING_PAYMENT',
  'ON_HOLD',
];
const PROPOSAL_STATUSES: InvitationStatus[] = [
  'PROPOSAL_SUBMITTED',
  'SELECTED_PENDING_PAYMENT',
  'ON_HOLD',
  'HIRED',
  'NOT_SELECTED',
];

/** Ordem da fila (docs/architecture.md §6): prioridade por espera, depois round-robin. */
/**
 * Ordem da fila (docs/architecture.md §6): prioridade (quem espera há mais tempo) e, depois, a
 * chave de justiça `last_invited_at − bônus × (score − 0,5) × 2` — desempenho adianta ou atrasa
 * a vez em até `bônus` horas. Nunca convidado vai na frente; score neutro (0,5) não muda nada.
 */
const fairnessKey = (bonusHours: number, alias?: string) => {
  const q = alias ? sql.raw(alias) : null;
  const lastInvited = q ? sql`${q}.last_invited_at` : sql`${queueEntries.lastInvitedAt}`;
  const score = q ? sql`${q}.score` : sql`${queueEntries.score}`;
  return sql`${lastInvited} - interval '1 second' * (${bonusHours * 3600} * (${score} - 0.5) * 2)`;
};

const queueOrder = (bonusHours: number) => [
  sql`(${queueEntries.tier} = 'PRIORITY') desc`,
  sql`${queueEntries.prioritySince} asc nulls last`,
  sql`${fairnessKey(bonusHours)} asc nulls first`,
  asc(queueEntries.userId),
];

/** Datas de SQL bruto chegam como string (node-postgres) ou Date (PGlite). */
const toDate = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string | Date);

type InvitationRow = typeof invitations.$inferSelect;

const toInvitationProps = (row: InvitationRow): InvitationProps => ({
  id: row.id,
  freelancerId: row.freelancerId,
  status: row.status,
  invitedAt: row.invitedAt,
  deadlineAt: row.deadlineAt,
  respondedAt: row.respondedAt,
  proposal:
    row.proposalAmountCents !== null &&
    row.proposalDeadlineDays !== null &&
    row.proposalMessage !== null &&
    row.proposalSubmittedAt
      ? {
          amountCents: row.proposalAmountCents,
          deadlineDays: row.proposalDeadlineDays,
          message: row.proposalMessage,
          submittedAt: row.proposalSubmittedAt,
          updatedAt: row.proposalUpdatedAt ?? row.proposalSubmittedAt,
        }
      : null,
  feedback: row.selectionFeedback,
  updatedAt: row.updatedAt,
});

export class DrizzleRoundRepository implements RoundRepository {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  async findById(roundId: string): Promise<DistributionRound | null> {
    const [row] = await this.ctx.executor
      .select()
      .from(distributionRounds)
      .where(eq(distributionRounds.id, roundId))
      .limit(1);
    return row ? this.hydrate(row) : null;
  }

  async findByInvitation(invitationId: string): Promise<DistributionRound | null> {
    const [row] = await this.ctx.executor
      .select({ roundId: invitations.roundId })
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    return row ? this.findById(row.roundId) : null;
  }

  async findActiveByProject(projectId: string): Promise<DistributionRound | null> {
    const [row] = await this.ctx.executor
      .select()
      .from(distributionRounds)
      .where(
        and(
          eq(distributionRounds.projectId, projectId),
          inArray(distributionRounds.status, ['OPEN', 'SELECTED']),
        ),
      )
      .limit(1);
    return row ? this.hydrate(row) : null;
  }

  async withOverdueInvitations(now: Date, limit: number): Promise<string[]> {
    const rows = await this.ctx.executor
      .selectDistinct({ roundId: invitations.roundId })
      .from(invitations)
      .innerJoin(distributionRounds, eq(distributionRounds.id, invitations.roundId))
      .where(
        and(
          eq(invitations.status, 'INVITED'),
          lte(invitations.deadlineAt, now),
          eq(distributionRounds.status, 'OPEN'),
        ),
      )
      .limit(limit);
    return rows.map((row) => row.roundId);
  }

  async activeWithFreelancer(freelancerId: string): Promise<string[]> {
    const rows = await this.ctx.executor
      .selectDistinct({ roundId: invitations.roundId })
      .from(invitations)
      .innerJoin(distributionRounds, eq(distributionRounds.id, invitations.roundId))
      .where(
        and(
          eq(invitations.freelancerId, freelancerId),
          inArray(invitations.status, ['INVITED', 'PROPOSAL_SUBMITTED', 'ON_HOLD']),
          inArray(distributionRounds.status, ['OPEN', 'SELECTED']),
        ),
      );
    return rows.map((row) => row.roundId);
  }

  save(round: DistributionRound): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.executor;
      const s = round.toSnapshot();
      const row = {
        status: s.status,
        levelSlug: s.levelSlug,
        projectType: s.projectType,
        requiredStacks: s.requiredStacks,
        clientId: s.clientId,
        params: s.params,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
      };
      if (s.version === 0) {
        await db
          .insert(distributionRounds)
          .values({ ...row, id: s.id, projectId: s.projectId, version: 1 });
      } else {
        const updated = await db
          .update(distributionRounds)
          .set({ ...row, version: s.version + 1 })
          .where(and(eq(distributionRounds.id, s.id), eq(distributionRounds.version, s.version)))
          .returning({ id: distributionRounds.id });
        if (updated.length === 0) throw new ConcurrencyError('DistributionRound', s.id);
      }
      for (const invitation of s.invitations) {
        const values = {
          status: invitation.status,
          deadlineAt: invitation.deadlineAt,
          respondedAt: invitation.respondedAt,
          proposalAmountCents: invitation.proposal?.amountCents ?? null,
          proposalDeadlineDays: invitation.proposal?.deadlineDays ?? null,
          proposalMessage: invitation.proposal?.message ?? null,
          proposalSubmittedAt: invitation.proposal?.submittedAt ?? null,
          proposalUpdatedAt: invitation.proposal?.updatedAt ?? null,
          selectionFeedback: invitation.feedback,
          updatedAt: invitation.updatedAt,
        };
        await db
          .insert(invitations)
          .values({
            ...values,
            id: invitation.id,
            roundId: s.id,
            projectId: s.projectId,
            freelancerId: invitation.freelancerId,
            invitedAt: invitation.invitedAt,
          })
          .onConflictDoUpdate({ target: invitations.id, set: values });
      }
      await appendToOutbox(db, assignEventIds(round.pullEvents(), this.ids));
      round.markPersisted();
    });
  }

  private async hydrate(row: typeof distributionRounds.$inferSelect): Promise<DistributionRound> {
    const invitationRows = await this.ctx.executor
      .select()
      .from(invitations)
      .where(eq(invitations.roundId, row.id))
      .orderBy(asc(invitations.invitedAt), asc(invitations.id));
    return DistributionRound.rehydrate({
      id: row.id,
      projectId: row.projectId,
      clientId: row.clientId,
      status: row.status,
      levelSlug: row.levelSlug,
      projectType: row.projectType as ProjectType,
      requiredStacks: row.requiredStacks,
      params: row.params,
      openedAt: row.openedAt,
      closedAt: row.closedAt,
      invitations: invitationRows.map(toInvitationProps),
      version: row.version,
    });
  }
}

export class DrizzleQueueRepository implements QueueRepository {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  async find(userId: string): Promise<QueueEntry | null> {
    return (await this.findMany([userId]))[0] ?? null;
  }

  async findMany(userIds: readonly string[]): Promise<QueueEntry[]> {
    if (userIds.length === 0) return [];
    const rows = await this.ctx.executor
      .select()
      .from(queueEntries)
      .where(inArray(queueEntries.userId, [...new Set(userIds)]));
    return rows.map((row) => QueueEntry.rehydrate(row));
  }

  save(entry: QueueEntry): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.executor;
      const { userId, version, ...row } = entry.toSnapshot();
      if (version === 0) {
        await db.insert(queueEntries).values({ ...row, userId, version: 1 });
      } else {
        const updated = await db
          .update(queueEntries)
          .set({ ...row, version: version + 1 })
          .where(and(eq(queueEntries.userId, userId), eq(queueEntries.version, version)))
          .returning({ userId: queueEntries.userId });
        if (updated.length === 0) throw new ConcurrencyError('QueueEntry', userId);
      }
      await appendToOutbox(db, assignEventIds(entry.pullEvents(), this.ids));
      entry.markPersisted();
    });
  }

  async lockLevel(levelSlug: string): Promise<void> {
    await this.ctx.executor.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`distribution:${levelSlug}`}))`,
    );
  }

  /** Elegibilidade (docs/architecture.md §6) + ordem da fila, com as linhas bloqueadas. */
  async nextCandidates(query: CandidateQuery): Promise<string[]> {
    const q = queueEntries;
    const fp = freelancerProfiles;
    const rows = await this.ctx.executor
      .select({ userId: q.userId })
      .from(q)
      .innerJoin(fp, eq(fp.userId, q.userId))
      .innerJoin(users, eq(users.id, q.userId))
      .where(
        and(
          eq(q.levelSlug, query.levelSlug),
          eq(q.state, 'ACTIVE'),
          eq(fp.status, 'APPROVED'),
          eq(fp.available, true),
          eq(users.status, 'ACTIVE'),
          sql`${query.projectType} = any(${fp.projectTypes})`,
          query.requiredStacks.length > 0
            ? exists(
                this.ctx.executor
                  .select({ one: sql`1` })
                  .from(freelancerStacks)
                  .where(
                    and(
                      eq(freelancerStacks.userId, q.userId),
                      inArray(freelancerStacks.stackSlug, query.requiredStacks),
                    ),
                  ),
              )
            : undefined,
          lt(q.openInvitations, query.maxOpenInvitations),
          ne(q.userId, query.clientId),
          notExists(
            this.ctx.executor
              .select({ one: sql`1` })
              .from(invitations)
              .where(
                and(
                  eq(invitations.projectId, query.projectId),
                  eq(invitations.freelancerId, q.userId),
                ),
              ),
          ),
        ),
      )
      .orderBy(...queueOrder(query.performanceBonusHours))
      .limit(query.limit)
      .for('update', { of: q, skipLocked: true });
    return rows.map((row) => row.userId);
  }
}

interface RankedRow {
  user_id: string;
  position: number | string | null;
  [key: string]: unknown;
}

export class DrizzleDistributionQueries implements DistributionQueries {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly settings: SettingsReader,
  ) {}

  async listForFreelancer(input: {
    freelancerId: string;
    view: 'open' | 'history';
    limit: number;
    after: { invitedAt: Date; id: string } | null;
  }) {
    const { after } = input;
    const statusFilter =
      input.view === 'open'
        ? inArray(invitations.status, OPEN_FOR_FREELANCER)
        : notInArray(invitations.status, OPEN_FOR_FREELANCER);
    const rows = await this.ctx.executor
      .select({
        id: invitations.id,
        status: invitations.status,
        invitedAt: invitations.invitedAt,
        deadlineAt: invitations.deadlineAt,
        hasProposal: sql<boolean>`${invitations.proposalSubmittedAt} is not null`,
        projectId: projects.id,
        title: projects.title,
        type: projects.type,
        scope: projects.scope,
      })
      .from(invitations)
      .innerJoin(projects, eq(projects.id, invitations.projectId))
      .where(
        and(
          eq(invitations.freelancerId, input.freelancerId),
          statusFilter,
          after
            ? or(
                lt(invitations.invitedAt, after.invitedAt),
                and(eq(invitations.invitedAt, after.invitedAt), lt(invitations.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(invitations.invitedAt), desc(invitations.id))
      .limit(input.limit);
    return rows.map((row) => {
      const scope = row.scope as Scope;
      return {
        id: row.id,
        status: row.status,
        invitedAt: row.invitedAt,
        deadlineAt: row.deadlineAt,
        hasProposal: Boolean(row.hasProposal),
        project: {
          id: row.projectId,
          title: row.title,
          type: row.type,
          priceRange: scope.priceRange,
          deadlineDays: scope.deadlineDays,
        },
      };
    });
  }

  async proposalsForProject(projectId: string) {
    const db = this.ctx.executor;
    const [round] = await db
      .select({ id: distributionRounds.id })
      .from(distributionRounds)
      .where(eq(distributionRounds.projectId, projectId))
      .orderBy(desc(distributionRounds.openedAt))
      .limit(1);
    if (!round) return { awaitingResponses: 0, proposals: [] };

    const [awaiting] = await db
      .select({ total: count() })
      .from(invitations)
      .where(and(eq(invitations.roundId, round.id), eq(invitations.status, 'INVITED')));
    const rows = await db
      .select({
        invitationId: invitations.id,
        status: invitations.status,
        amountCents: invitations.proposalAmountCents,
        deadlineDays: invitations.proposalDeadlineDays,
        message: invitations.proposalMessage,
        submittedAt: invitations.proposalSubmittedAt,
        userId: users.id,
        displayName: users.displayName,
        headline: freelancerProfiles.headline,
        levelSlug: levels.slug,
        levelName: levels.name,
        levelRank: levels.rank,
        stacks: sql<
          string[]
        >`coalesce((select array_agg(${freelancerStacks.stackSlug} order by ${freelancerStacks.stackSlug}) from ${freelancerStacks} where ${freelancerStacks.userId} = ${users.id}), '{}')`,
        portfolioItems:
          sql<number>`(select count(*) from ${portfolioItems} where ${portfolioItems.userId} = ${users.id})`.mapWith(
            Number,
          ),
        completedContracts: freelancerStats.completedContracts,
        ratingCount: freelancerStats.ratingCount,
        ratingSum: freelancerStats.ratingSum,
      })
      .from(invitations)
      .innerJoin(users, eq(users.id, invitations.freelancerId))
      .leftJoin(freelancerStats, eq(freelancerStats.userId, users.id))
      .leftJoin(freelancerProfiles, eq(freelancerProfiles.userId, users.id))
      .leftJoin(levels, eq(levels.slug, freelancerProfiles.levelSlug))
      .where(and(eq(invitations.roundId, round.id), inArray(invitations.status, PROPOSAL_STATUSES)))
      .orderBy(asc(invitations.proposalSubmittedAt));
    return {
      awaitingResponses: awaiting?.total ?? 0,
      proposals: rows.map((row) => ({
        invitationId: row.invitationId,
        status: row.status,
        freelancer: {
          userId: row.userId,
          displayName: row.displayName,
          headline: row.headline ?? '',
          level:
            row.levelSlug && row.levelName && row.levelRank !== null
              ? { slug: row.levelSlug, name: row.levelName, rank: row.levelRank }
              : null,
          stacks: row.stacks,
          portfolioItems: row.portfolioItems,
          reputation: {
            completedContracts: row.completedContracts ?? 0,
            ratingCount: row.ratingCount ?? 0,
            ratingAvg:
              row.ratingCount && row.ratingSum
                ? Math.round((row.ratingSum / row.ratingCount) * 10) / 10
                : null,
          },
        },
        amountCents: row.amountCents ?? 0,
        deadlineDays: row.deadlineDays ?? 0,
        message: row.message ?? '',
        submittedAt: row.submittedAt ?? new Date(0),
      })),
    };
  }

  /** Posição calculada com a mesma ordem usada nos convites, entre os ATIVOS do nível. */
  private async ranked(filter: { levelSlug: string | null; state: QueueState }) {
    const bonusHours = await this.settings.get('queue.performanceBonusHours');
    const result = await this.ctx.executor.execute<RankedRow>(sql`
      select q.*, u.display_name,
        (fp.status = 'APPROVED' and fp.available and u.status = 'ACTIVE') as available,
        case when q.state = 'ACTIVE' then row_number() over (
          partition by q.level_slug, q.state
          order by (q.tier = 'PRIORITY') desc, q.priority_since asc nulls last,
                   ${fairnessKey(bonusHours, 'q')} asc nulls first, q.user_id asc
        ) end as position
      from ${queueEntries} q
      join ${users} u on u.id = q.user_id
      left join ${freelancerProfiles} fp on fp.user_id = q.user_id
      where q.state = ${filter.state}
        ${filter.levelSlug ? sql`and q.level_slug = ${filter.levelSlug}` : sql``}
      order by q.level_slug, position nulls last, q.monitoring_since asc nulls last, q.user_id
    `);
    return result.rows;
  }

  private toAdminEntry(row: RankedRow): AdminQueueEntry {
    return {
      position: row.position === null ? null : Number(row.position),
      userId: row.user_id,
      displayName: String(row.display_name),
      levelSlug: String(row.level_slug),
      state: row.state as QueueState,
      tier: row.tier as QueueTier,
      prioritySince: toDate(row.priority_since)?.toISOString() ?? null,
      lastInvitedAt: toDate(row.last_invited_at)?.toISOString() ?? null,
      roundsWithoutSelection: Number(row.rounds_without_selection),
      openInvitations: Number(row.open_invitations),
      declines: Number(row.declines),
      noResponses: Number(row.no_responses),
      selections: Number(row.selections),
      score: Number(row.score),
      available: Boolean(row.available),
    };
  }

  async adminQueue(input: { levelSlug: string | null; state: QueueState }) {
    return (await this.ranked(input)).map((row) => this.toAdminEntry(row));
  }

  async adminQueueEntry(userId: string): Promise<AdminQueueEntry | null> {
    const [entry] = await this.ctx.executor
      .select({ levelSlug: queueEntries.levelSlug, state: queueEntries.state })
      .from(queueEntries)
      .where(eq(queueEntries.userId, userId));
    if (!entry) return null;
    const row = (await this.ranked(entry)).find((candidate) => candidate.user_id === userId);
    return row ? this.toAdminEntry(row) : null;
  }

  async myQueueStatus(userId: string): Promise<MyQueueStatus> {
    const [entry] = await this.ctx.executor
      .select({
        levelSlug: queueEntries.levelSlug,
        state: queueEntries.state,
        tier: queueEntries.tier,
        openInvitations: queueEntries.openInvitations,
        levelName: levels.name,
        levelRank: levels.rank,
      })
      .from(queueEntries)
      .innerJoin(levels, eq(levels.slug, queueEntries.levelSlug))
      .where(eq(queueEntries.userId, userId));
    if (!entry) {
      return {
        inQueue: false,
        level: null,
        state: null,
        tier: null,
        position: null,
        totalInLevel: 0,
        openInvitations: 0,
      };
    }
    const rows = await this.ranked({ levelSlug: entry.levelSlug, state: 'ACTIVE' });
    const mine = rows.find((row) => row.user_id === userId);
    return {
      inQueue: true,
      level: { slug: entry.levelSlug, name: entry.levelName, rank: entry.levelRank },
      state: entry.state,
      tier: entry.tier,
      position:
        mine?.position === null || mine?.position === undefined ? null : Number(mine.position),
      totalInLevel: rows.length,
      openInvitations: entry.openInvitations,
    };
  }

  async adminDistribution(projectId: string): Promise<AdminDistribution> {
    const db = this.ctx.executor;
    const [round] = await db
      .select()
      .from(distributionRounds)
      .where(eq(distributionRounds.projectId, projectId))
      .orderBy(desc(distributionRounds.openedAt))
      .limit(1);
    if (!round) return { round: null, invitations: [] };
    const rows = await db
      .select({ invitation: invitations, displayName: users.displayName })
      .from(invitations)
      .innerJoin(users, eq(users.id, invitations.freelancerId))
      .where(eq(invitations.roundId, round.id))
      .orderBy(asc(invitations.invitedAt), asc(invitations.id));
    return {
      round: {
        id: round.id,
        status: round.status,
        levelSlug: round.levelSlug,
        roundSize: round.params.roundSize,
        maxInvites: round.params.maxInvites,
        inviteResponseHours: round.params.inviteResponseHours,
        openedAt: round.openedAt.toISOString(),
      },
      invitations: rows.map(({ invitation, displayName }) => ({
        id: invitation.id,
        freelancer: { userId: invitation.freelancerId, displayName },
        status: invitation.status,
        invitedAt: invitation.invitedAt.toISOString(),
        deadlineAt: invitation.deadlineAt.toISOString(),
        amountCents: invitation.proposalAmountCents,
        deadlineDays: invitation.proposalDeadlineDays,
        feedback: invitation.selectionFeedback,
      })),
    };
  }
}

export class DrizzleDistributionPeople implements PeopleDirectory {
  constructor(private readonly ctx: DatabaseContext) {}

  async find(userId: string): Promise<{ displayName: string; email: string } | null> {
    const [row] = await this.ctx.executor
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }
}
