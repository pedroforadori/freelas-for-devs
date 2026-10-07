import type { FreelancerProfileStatus, Level, ProjectType, Stack } from '@f4d/contracts';
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { levels, stacks } from '../../../db/schema/catalog.js';
import { users } from '../../../db/schema/identity.js';
import {
  clientProfiles,
  freelancerProfiles,
  freelancerStacks,
  levelChanges,
  portfolioItems,
} from '../../../db/schema/profiles.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import {
  appendToOutbox,
  assignEventIds,
} from '../../../shared/infra/outbox/drizzle-outbox.store.js';
import { ConcurrencyError } from '../../../shared/kernel/domain-error.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type {
  Catalog,
  ClientProfileRepository,
  FreelancerProfileRepository,
  LevelHistory,
  LevelHistoryEntry,
  PeopleDirectory,
  ReviewQueue,
  ReviewQueueItem,
} from '../application/ports.js';
import { FreelancerProfile } from '../domain/freelancer-profile.js';

export class DrizzleFreelancerProfileRepository implements FreelancerProfileRepository {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  async find(userId: string): Promise<FreelancerProfile | null> {
    const db = this.ctx.executor;
    const [row] = await db
      .select()
      .from(freelancerProfiles)
      .where(eq(freelancerProfiles.userId, userId))
      .limit(1);
    if (!row) return null;
    const [stackRows, items] = await Promise.all([
      db
        .select({ slug: freelancerStacks.stackSlug })
        .from(freelancerStacks)
        .where(eq(freelancerStacks.userId, userId)),
      db
        .select()
        .from(portfolioItems)
        .where(eq(portfolioItems.userId, userId))
        .orderBy(asc(portfolioItems.position)),
    ]);
    return FreelancerProfile.rehydrate({
      userId: row.userId,
      headline: row.headline,
      bio: row.bio,
      stacks: stackRows.map((s) => s.slug).sort(),
      projectTypes: row.projectTypes as ProjectType[],
      links: row.links,
      available: row.available,
      status: row.status,
      levelSlug: row.levelSlug,
      reviewNote: row.reviewNote,
      submittedAt: row.submittedAt,
      reviewedAt: row.reviewedAt,
      reviewedBy: row.reviewedBy,
      portfolio: items.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        url: item.url,
        stacks: item.stacks,
      })),
      updatedAt: row.updatedAt,
      version: row.version,
    });
  }

  save(profile: FreelancerProfile): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.executor;
      const s = profile.toSnapshot();
      const row = {
        headline: s.headline,
        bio: s.bio,
        projectTypes: s.projectTypes,
        links: s.links,
        available: s.available,
        status: s.status,
        levelSlug: s.levelSlug,
        reviewNote: s.reviewNote,
        submittedAt: s.submittedAt,
        reviewedAt: s.reviewedAt,
        reviewedBy: s.reviewedBy,
        updatedAt: s.updatedAt,
      };

      if (s.version === 0) {
        await db.insert(freelancerProfiles).values({ ...row, userId: s.userId, version: 1 });
      } else {
        const updated = await db
          .update(freelancerProfiles)
          .set({ ...row, version: s.version + 1 })
          .where(
            and(eq(freelancerProfiles.userId, s.userId), eq(freelancerProfiles.version, s.version)),
          )
          .returning({ userId: freelancerProfiles.userId });
        if (updated.length === 0) throw new ConcurrencyError('FreelancerProfile', s.userId);
      }

      await db.delete(freelancerStacks).where(eq(freelancerStacks.userId, s.userId));
      if (s.stacks.length > 0) {
        await db
          .insert(freelancerStacks)
          .values(s.stacks.map((stackSlug) => ({ userId: s.userId, stackSlug })));
      }
      await db.delete(portfolioItems).where(eq(portfolioItems.userId, s.userId));
      if (s.portfolio.length > 0) {
        await db
          .insert(portfolioItems)
          .values(s.portfolio.map((item, position) => ({ ...item, userId: s.userId, position })));
      }
      await appendToOutbox(db, assignEventIds(profile.pullEvents(), this.ids));
      profile.markPersisted();
    });
  }
}

/** Catálogo muda raramente: cache em memória por processo, renovado a cada 5 minutos. */
export class DrizzleCatalog implements Catalog {
  private cache: { at: number; stacks: Stack[]; levels: Level[] } | undefined;

  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ttlMs = 5 * 60_000,
  ) {}

  async listStacks(): Promise<Stack[]> {
    return (await this.load()).stacks;
  }

  async listLevels(): Promise<Level[]> {
    return (await this.load()).levels;
  }

  async unknownStacks(slugs: readonly string[]): Promise<string[]> {
    const known = new Set((await this.load()).stacks.map((s) => s.slug));
    return [...new Set(slugs)].filter((slug) => !known.has(slug));
  }

  async findLevel(slug: string): Promise<Level | null> {
    return (await this.load()).levels.find((level) => level.slug === slug) ?? null;
  }

  async initialLevel(): Promise<Level> {
    const [first] = (await this.load()).levels;
    if (!first) throw new Error('Nenhum nível cadastrado (seed ausente).');
    return first;
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache;
    const db = this.ctx.executor;
    const [stackRows, levelRows] = await Promise.all([
      db.select().from(stacks).orderBy(asc(stacks.category), asc(stacks.name)),
      db.select().from(levels).orderBy(asc(levels.rank)),
    ]);
    this.cache = { at: Date.now(), stacks: stackRows, levels: levelRows };
    return this.cache;
  }
}

export class DrizzleLevelHistory implements LevelHistory {
  constructor(private readonly ctx: DatabaseContext) {}

  async record(entry: {
    id: string;
    userId: string;
    from: string | null;
    to: string;
    reason: string;
    changedBy: string | null;
  }): Promise<void> {
    await this.ctx.executor.insert(levelChanges).values({
      id: entry.id,
      userId: entry.userId,
      fromLevel: entry.from,
      toLevel: entry.to,
      reason: entry.reason,
      changedBy: entry.changedBy,
    });
  }

  async list(userId: string): Promise<LevelHistoryEntry[]> {
    const rows = await this.ctx.executor
      .select()
      .from(levelChanges)
      .where(eq(levelChanges.userId, userId))
      .orderBy(desc(levelChanges.createdAt));
    return rows.map((row) => ({
      from: row.fromLevel,
      to: row.toLevel,
      reason: row.reason,
      changedAt: row.createdAt,
    }));
  }
}

/** Leitura de dados de identidade para apresentação (o módulo de identidade é o dono). */
export class DrizzlePeopleDirectory implements PeopleDirectory {
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

export class DrizzleReviewQueue implements ReviewQueue {
  constructor(private readonly ctx: DatabaseContext) {}

  async list(input: {
    status: FreelancerProfileStatus;
    limit: number;
    after: { submittedAt: Date | null; userId: string } | null;
  }): Promise<ReviewQueueItem[]> {
    const fp = freelancerProfiles;
    const { after } = input;
    // Ordem (submitted_at NULLS LAST, user_id): estável e indexada para paginação keyset.
    const keyset = after
      ? after.submittedAt
        ? or(
            gt(fp.submittedAt, after.submittedAt),
            and(eq(fp.submittedAt, after.submittedAt), gt(fp.userId, after.userId)),
            isNull(fp.submittedAt),
          )
        : and(isNull(fp.submittedAt), gt(fp.userId, after.userId))
      : undefined;

    const rows = await this.ctx.executor
      .select({
        userId: fp.userId,
        displayName: users.displayName,
        email: users.email,
        headline: fp.headline,
        status: fp.status,
        levelSlug: fp.levelSlug,
        submittedAt: fp.submittedAt,
        stacks: sql<
          string[]
        >`coalesce(array_agg(${freelancerStacks.stackSlug} order by ${freelancerStacks.stackSlug}) filter (where ${freelancerStacks.stackSlug} is not null), '{}')`,
      })
      .from(fp)
      .innerJoin(users, eq(users.id, fp.userId))
      .leftJoin(freelancerStacks, eq(freelancerStacks.userId, fp.userId))
      .where(and(eq(fp.status, input.status), keyset))
      .groupBy(fp.userId, users.displayName, users.email)
      .orderBy(sql`${fp.submittedAt} asc nulls last`, asc(fp.userId))
      .limit(input.limit);
    return rows;
  }
}

export class DrizzleClientProfileRepository implements ClientProfileRepository {
  constructor(private readonly ctx: DatabaseContext) {}

  async find(userId: string) {
    const [row] = await this.ctx.executor
      .select({ userId: clientProfiles.userId, companyName: clientProfiles.companyName })
      .from(clientProfiles)
      .where(eq(clientProfiles.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async upsert(profile: { userId: string; companyName: string | null }): Promise<void> {
    await this.ctx.executor
      .insert(clientProfiles)
      .values(profile)
      .onConflictDoUpdate({
        target: clientProfiles.userId,
        set: { companyName: profile.companyName, updatedAt: sql`now()` },
      });
  }
}
