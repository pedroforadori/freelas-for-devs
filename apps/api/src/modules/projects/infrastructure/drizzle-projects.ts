import type { Level, ProjectStatus, ScopingMetrics, Stack } from '@f4d/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { levels, stacks } from '../../../db/schema/catalog.js';
import { files } from '../../../db/schema/files.js';
import { users } from '../../../db/schema/identity.js';
import {
  aiEstimationRuns,
  projectAttachments,
  projects,
  scopeVersions,
} from '../../../db/schema/projects.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import {
  appendToOutbox,
  assignEventIds,
} from '../../../shared/infra/outbox/drizzle-outbox.store.js';
import { ConcurrencyError } from '../../../shared/kernel/domain-error.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type {
  AdminProjectListItem,
  AiRunEntry,
  AiRunLog,
  AttachmentDirectory,
  AttachmentView,
  Keyset,
  PeopleDirectory,
  ProjectCatalog,
  ProjectListItem,
  ProjectQueries,
  ProjectRepository,
} from '../application/ports.js';
import { Project, type ScopeVersionRecord } from '../domain/project.js';

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  async find(id: string): Promise<Project | null> {
    const db = this.ctx.executor;
    const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) return null;
    const attachments = await db
      .select({ fileId: projectAttachments.fileId })
      .from(projectAttachments)
      .where(eq(projectAttachments.projectId, id))
      .orderBy(asc(projectAttachments.position));
    const clarification = row.clarification;
    return Project.rehydrate({
      id: row.id,
      clientId: row.clientId,
      title: row.title,
      type: row.type,
      description: row.description,
      references: row.references,
      desiredDeadline: row.desiredDeadline,
      attachmentIds: attachments.map((a) => a.fileId),
      status: row.status,
      estimationRound: row.estimationRound,
      clarification: clarification
        ? {
            questions: clarification.questions,
            answers: clarification.answers,
            askedAt: new Date(clarification.askedAt),
            answeredAt: clarification.answeredAt ? new Date(clarification.answeredAt) : null,
          }
        : null,
      estimate: row.estimate,
      estimateFailed: row.estimateFailed,
      scope: row.scope,
      scopeVersion: row.scopeVersion,
      scopingStartedAt: row.scopingStartedAt,
      scopeApprovedAt: row.scopeApprovedAt,
      scopeApprovedBy: row.scopeApprovedBy,
      rejectionReason: row.rejectionReason,
      rejectedAt: row.rejectedAt,
      cancelReason: row.cancelReason,
      cancelledAt: row.cancelledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
  }

  save(project: Project): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.executor;
      const s = project.toSnapshot();
      const row = {
        title: s.title,
        type: s.type,
        description: s.description,
        references: s.references,
        desiredDeadline: s.desiredDeadline,
        status: s.status,
        estimationRound: s.estimationRound,
        clarification: s.clarification
          ? {
              questions: s.clarification.questions,
              answers: s.clarification.answers,
              askedAt: s.clarification.askedAt.toISOString(),
              answeredAt: s.clarification.answeredAt?.toISOString() ?? null,
            }
          : null,
        estimate: s.estimate,
        estimateFailed: s.estimateFailed,
        scope: s.scope,
        scopeVersion: s.scopeVersion,
        scopingStartedAt: s.scopingStartedAt,
        scopeApprovedAt: s.scopeApprovedAt,
        scopeApprovedBy: s.scopeApprovedBy,
        rejectionReason: s.rejectionReason,
        rejectedAt: s.rejectedAt,
        cancelReason: s.cancelReason,
        cancelledAt: s.cancelledAt,
        updatedAt: s.updatedAt,
      };

      if (s.version === 0) {
        await db.insert(projects).values({
          ...row,
          id: s.id,
          clientId: s.clientId,
          createdAt: s.createdAt,
          version: 1,
        });
        // Anexos são definidos na publicação e não mudam depois.
        if (s.attachmentIds.length > 0) {
          await db
            .insert(projectAttachments)
            .values(
              s.attachmentIds.map((fileId, position) => ({ projectId: s.id, fileId, position })),
            );
        }
      } else {
        const updated = await db
          .update(projects)
          .set({ ...row, version: s.version + 1 })
          .where(and(eq(projects.id, s.id), eq(projects.version, s.version)))
          .returning({ id: projects.id });
        if (updated.length === 0) throw new ConcurrencyError('Project', s.id);
      }
      const versions = project.pullNewScopeVersions();
      if (versions.length > 0) {
        await db
          .insert(scopeVersions)
          .values(versions.map((version) => ({ ...version, projectId: s.id })));
      }
      await appendToOutbox(db, assignEventIds(project.pullEvents(), this.ids));
      project.markPersisted();
    });
  }
}

const HOUR_MS = 60 * 60 * 1000;
const round1 = (value: number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(value * 10) / 10;

/** Ponto médio de uma faixa guardada em JSONB (`{"priceRange": {"minCents", "maxCents"}}`). */
const midpoint = (column: typeof projects.scope | typeof projects.estimate) =>
  sql`(((${column} -> 'priceRange' ->> 'minCents')::numeric + (${column} -> 'priceRange' ->> 'maxCents')::numeric) / 2)`;

const summaryColumns = {
  id: projects.id,
  title: projects.title,
  type: projects.type,
  status: projects.status,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

export class DrizzleProjectQueries implements ProjectQueries {
  constructor(private readonly ctx: DatabaseContext) {}

  async countCreatedSince(clientId: string, since: Date): Promise<number> {
    const [row] = await this.ctx.executor
      .select({ total: count() })
      .from(projects)
      .where(and(eq(projects.clientId, clientId), gte(projects.createdAt, since)));
    return row?.total ?? 0;
  }

  async countOpen(clientId: string): Promise<number> {
    const [row] = await this.ctx.executor
      .select({ total: count() })
      .from(projects)
      .where(and(eq(projects.clientId, clientId), ne(projects.status, 'CANCELLED')));
    return row?.total ?? 0;
  }

  listByClient(input: {
    clientId: string;
    limit: number;
    after: Keyset | null;
  }): Promise<ProjectListItem[]> {
    const { after } = input;
    // Ordem (created_at DESC, id DESC), coberta pelo índice projects_client_idx.
    const keyset = after
      ? or(
          lt(projects.createdAt, after.createdAt),
          and(eq(projects.createdAt, after.createdAt), lt(projects.id, after.id)),
        )
      : undefined;
    return this.ctx.executor
      .select(summaryColumns)
      .from(projects)
      .where(and(eq(projects.clientId, input.clientId), keyset))
      .orderBy(desc(projects.createdAt), desc(projects.id))
      .limit(input.limit);
  }

  async listByStatus(input: {
    status: ProjectStatus;
    limit: number;
    after: Keyset | null;
  }): Promise<AdminProjectListItem[]> {
    const { after } = input;
    const keyset = after
      ? or(
          gt(projects.createdAt, after.createdAt),
          and(eq(projects.createdAt, after.createdAt), gt(projects.id, after.id)),
        )
      : undefined;
    const rows = await this.ctx.executor
      .select({
        ...summaryColumns,
        clientId: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.clientId))
      .where(and(eq(projects.status, input.status), keyset))
      .orderBy(asc(projects.createdAt), asc(projects.id))
      .limit(input.limit);
    return rows.map(({ clientId, displayName, email, ...summary }) => ({
      ...summary,
      client: { userId: clientId, displayName, email },
    }));
  }

  async listScopeVersions(projectId: string): Promise<ScopeVersionRecord[]> {
    return this.ctx.executor
      .select({
        version: scopeVersions.version,
        scope: scopeVersions.scope,
        createdBy: users.displayName,
        createdAt: scopeVersions.createdAt,
      })
      .from(scopeVersions)
      .innerJoin(users, eq(users.id, scopeVersions.createdBy))
      .where(eq(scopeVersions.projectId, projectId))
      .orderBy(desc(scopeVersions.version));
  }

  /** Gargalo do especialista (docs/architecture.md §10, risco 4) e calibragem da IA. */
  async scopingMetrics(now: Date): Promise<ScopingMetrics> {
    const db = this.ctx.executor;
    const since = new Date(now.getTime() - 30 * 24 * HOUR_MS);
    const hoursToApprove = sql`extract(epoch from (${projects.scopeApprovedAt} - ${projects.scopingStartedAt})) / 3600`;
    const approvedInWindow = and(
      isNotNull(projects.scopeApprovedAt),
      gte(projects.scopeApprovedAt, since),
      isNotNull(projects.scopingStartedAt),
    );

    const [queue] = await db
      .select({
        scoping: count(),
        oldest: sql`min(${projects.scopingStartedAt})`.mapWith(
          (value: string | Date) => new Date(value),
        ),
      })
      .from(projects)
      .where(eq(projects.status, 'SCOPING'));
    const [approved] = await db
      .select({
        approved: count(),
        median: sql`percentile_cont(0.5) within group (order by ${hoursToApprove})`.mapWith(Number),
        p90: sql`percentile_cont(0.9) within group (order by ${hoursToApprove})`.mapWith(Number),
        avgVersions: sql`avg(${projects.scopeVersion})`.mapWith(Number),
      })
      .from(projects)
      .where(approvedInWindow);
    const [deviation] = await db
      .select({
        samples: count(),
        median:
          sql`percentile_cont(0.5) within group (order by ${midpoint(projects.scope)} / nullif(${midpoint(projects.estimate)}, 0) - 1)`.mapWith(
            Number,
          ),
      })
      .from(projects)
      .where(and(approvedInWindow, isNotNull(projects.estimate)));
    const [rejected] = await db
      .select({ rejected: count() })
      .from(projects)
      .where(and(isNotNull(projects.rejectedAt), gte(projects.rejectedAt, since)));

    return {
      queue: {
        scoping: queue?.scoping ?? 0,
        oldestWaitingHours: queue?.oldest
          ? round1((now.getTime() - queue.oldest.getTime()) / HOUR_MS)
          : null,
      },
      last30Days: {
        approved: approved?.approved ?? 0,
        rejected: rejected?.rejected ?? 0,
        medianHoursToApprove: round1(approved?.median),
        p90HoursToApprove: round1(approved?.p90),
        avgVersionsPerApproval: round1(approved?.avgVersions),
        estimateDeviation: {
          samples: deviation?.samples ?? 0,
          medianPct:
            deviation?.median === null || deviation?.median === undefined
              ? null
              : Math.round(deviation.median * 1000) / 10,
        },
      },
    };
  }
}

export class DrizzleAttachmentDirectory implements AttachmentDirectory {
  constructor(private readonly ctx: DatabaseContext) {}

  async usableBy(ownerId: string, fileIds: readonly string[]): Promise<string[]> {
    if (fileIds.length === 0) return [];
    const rows = await this.ctx.executor
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          inArray(files.id, [...fileIds]),
          eq(files.ownerId, ownerId),
          eq(files.purpose, 'PROJECT_ATTACHMENT'),
          ne(files.status, 'REJECTED'),
        ),
      );
    return rows.map((row) => row.id);
  }

  async describe(fileIds: readonly string[]): Promise<AttachmentView[]> {
    if (fileIds.length === 0) return [];
    const rows = await this.ctx.executor
      .select({
        id: files.id,
        fileName: files.fileName,
        contentType: files.contentType,
        size: files.size,
        status: files.status,
      })
      .from(files)
      .where(inArray(files.id, [...fileIds]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return fileIds.flatMap((id) => byId.get(id) ?? []);
  }
}

export class DrizzleProjectCatalog implements ProjectCatalog {
  constructor(private readonly ctx: DatabaseContext) {}

  listLevels(): Promise<Level[]> {
    return this.ctx.executor.select().from(levels).orderBy(asc(levels.rank));
  }

  listStacks(): Promise<Stack[]> {
    return this.ctx.executor.select().from(stacks).orderBy(asc(stacks.slug));
  }
}

export class DrizzleProjectPeople implements PeopleDirectory {
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

export class DrizzleAiRunLog implements AiRunLog {
  constructor(private readonly ctx: DatabaseContext) {}

  async record(entry: AiRunEntry & { id: string }): Promise<void> {
    await this.ctx.executor.insert(aiEstimationRuns).values(entry);
  }

  async list(projectId: string): Promise<AiRunEntry[]> {
    return this.ctx.executor
      .select({
        projectId: aiEstimationRuns.projectId,
        round: aiEstimationRuns.round,
        outcome: aiEstimationRuns.outcome,
        model: aiEstimationRuns.model,
        promptVersion: aiEstimationRuns.promptVersion,
        inputTokens: aiEstimationRuns.inputTokens,
        outputTokens: aiEstimationRuns.outputTokens,
        durationMs: aiEstimationRuns.durationMs,
        error: aiEstimationRuns.error,
        createdAt: aiEstimationRuns.createdAt,
      })
      .from(aiEstimationRuns)
      .where(eq(aiEstimationRuns.projectId, projectId))
      .orderBy(asc(aiEstimationRuns.createdAt), asc(aiEstimationRuns.id));
  }
}
