import { and, count, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { users } from '../../../db/schema/identity.js';
import {
  contactViolations,
  conversationReads,
  conversations,
  messages,
  moderationActions,
} from '../../../db/schema/messaging.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import type { ContactKind } from '../../../shared/kernel/contact-detector.js';
import type {
  ConversationRecord,
  ConversationRepository,
  MessageRecord,
  MessageRepository,
  ModerationLog,
  PeopleDirectory,
  ReadMarkers,
  ViolationRecord,
  Violations,
  ViolationView,
} from '../application/ports.js';

export class DrizzleConversations implements ConversationRepository {
  constructor(private readonly ctx: DatabaseContext) {}

  private async one(where: ReturnType<typeof eq>) {
    const [row] = await this.ctx.executor.select().from(conversations).where(where).limit(1);
    return row ?? null;
  }

  find(id: string) {
    return this.one(eq(conversations.id, id));
  }

  findScoping(projectId: string) {
    return this.one(
      and(eq(conversations.projectId, projectId), eq(conversations.kind, 'SCOPING'))!,
    );
  }

  findByContract(contractId: string) {
    return this.one(eq(conversations.contractId, contractId));
  }

  async getOrCreate(record: ConversationRecord): Promise<ConversationRecord> {
    await this.ctx.executor.insert(conversations).values(record).onConflictDoNothing();
    const existing =
      record.kind === 'SCOPING'
        ? await this.findScoping(record.projectId)
        : await this.findByContract(record.contractId!);
    return existing ?? record;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.ctx.executor
      .update(conversations)
      .set({ lastMessageAt: at })
      .where(eq(conversations.id, id));
  }

  async listFor(userId: string, includeAllScoping: boolean, limit: number) {
    const rows = await this.ctx.executor
      .select()
      .from(conversations)
      .where(
        or(
          eq(conversations.clientId, userId),
          eq(conversations.freelancerId, userId),
          includeAllScoping ? eq(conversations.kind, 'SCOPING') : undefined,
        ),
      )
      .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.createdAt))
      .limit(limit);
    return rows as ConversationRecord[];
  }
}

export class DrizzleMessages implements MessageRepository {
  constructor(private readonly ctx: DatabaseContext) {}

  async add(message: MessageRecord): Promise<void> {
    await this.ctx.executor.insert(messages).values(message);
  }

  async page(
    conversationId: string,
    before: { createdAt: Date; id: string } | null,
    limit: number,
  ) {
    const rows = await this.ctx.executor
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          before
            ? or(
                lt(messages.createdAt, before.createdAt),
                and(eq(messages.createdAt, before.createdAt), lt(messages.id, before.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);
    return rows as MessageRecord[];
  }
}

export class DrizzleReadMarkers implements ReadMarkers {
  constructor(private readonly ctx: DatabaseContext) {}

  async markRead(conversationId: string, userId: string, at: Date): Promise<void> {
    await this.ctx.executor
      .insert(conversationReads)
      .values({ conversationId, userId, lastReadAt: at })
      .onConflictDoUpdate({
        target: [conversationReads.conversationId, conversationReads.userId],
        set: { lastReadAt: sql`greatest(${conversationReads.lastReadAt}, ${at})` },
      });
  }

  async unreadCounts(userId: string, conversationIds: readonly string[]) {
    if (conversationIds.length === 0) return new Map<string, number>();
    const rows = await this.ctx.executor
      .select({ conversationId: messages.conversationId, unread: count() })
      .from(messages)
      .leftJoin(
        conversationReads,
        and(
          eq(conversationReads.conversationId, messages.conversationId),
          eq(conversationReads.userId, userId),
        ),
      )
      .where(
        and(
          inArray(messages.conversationId, [...conversationIds]),
          ne(messages.senderId, userId),
          or(
            isNull(conversationReads.lastReadAt),
            gt(messages.createdAt, conversationReads.lastReadAt),
          ),
        ),
      )
      .groupBy(messages.conversationId);
    return new Map(rows.map((row) => [row.conversationId, row.unread]));
  }
}

export class DrizzleViolations implements Violations {
  constructor(private readonly ctx: DatabaseContext) {}

  async add(record: ViolationRecord): Promise<void> {
    await this.ctx.executor.insert(contactViolations).values(record);
  }

  async countSince(userId: string, since: Date): Promise<number> {
    const [row] = await this.ctx.executor
      .select({ total: count() })
      .from(contactViolations)
      .where(and(eq(contactViolations.userId, userId), gte(contactViolations.createdAt, since)));
    return row?.total ?? 0;
  }

  async find(id: string): Promise<ViolationRecord | null> {
    const [row] = await this.ctx.executor
      .select()
      .from(contactViolations)
      .where(eq(contactViolations.id, id))
      .limit(1);
    return row ? { ...row, kinds: row.kinds as ContactKind[] } : null;
  }

  async listRecent(limit: number, since: Date): Promise<ViolationView[]> {
    const rows = await this.ctx.executor
      .select({
        id: contactViolations.id,
        userId: contactViolations.userId,
        source: contactViolations.source,
        referenceId: contactViolations.referenceId,
        projectId: contactViolations.projectId,
        kinds: contactViolations.kinds,
        maskedText: contactViolations.maskedText,
        createdAt: contactViolations.createdAt,
        displayName: users.displayName,
        email: users.email,
        status: users.status,
        recentViolations: sql<number>`(
          select count(*) from ${contactViolations} cv
          where cv.user_id = ${contactViolations.userId} and cv.created_at >= ${since}
        )`.mapWith(Number),
      })
      .from(contactViolations)
      .innerJoin(users, eq(users.id, contactViolations.userId))
      .orderBy(desc(contactViolations.createdAt))
      .limit(limit);
    return rows.map(({ displayName, email, status, ...row }) => ({
      ...row,
      kinds: row.kinds as ContactKind[],
      user: { displayName, email, status },
    }));
  }
}

export class DrizzleModerationLog implements ModerationLog {
  constructor(private readonly ctx: DatabaseContext) {}

  async add(action: Parameters<ModerationLog['add']>[0]): Promise<void> {
    await this.ctx.executor.insert(moderationActions).values(action);
  }
}

export class DrizzleMessagingPeople implements PeopleDirectory {
  constructor(private readonly ctx: DatabaseContext) {}

  async find(userId: string) {
    const [row] = await this.ctx.executor
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }
}
