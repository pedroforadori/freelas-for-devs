import { and, desc, eq, inArray, isNotNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { auditLog } from '../../../db/schema/audit.js';
import {
  contractRatings,
  contracts,
  deliveries,
  disputes,
  webhookEvents,
} from '../../../db/schema/contracts.js';
import { invitations } from '../../../db/schema/distribution.js';
import { files } from '../../../db/schema/files.js';
import {
  authIdentities,
  oneTimeTokens,
  refreshTokens,
  userRoles,
  users,
} from '../../../db/schema/identity.js';
import { leads } from '../../../db/schema/leads.js';
import { contactViolations, messages } from '../../../db/schema/messaging.js';
import { outboxEvents } from '../../../db/schema/outbox.js';
import {
  clientProfiles,
  freelancerProfiles,
  freelancerStacks,
  levelChanges,
  portfolioItems,
} from '../../../db/schema/profiles.js';
import { projects } from '../../../db/schema/projects.js';
import { freelancerStats } from '../../../db/schema/reputation.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import type { PersonalData, Retention } from '../application/ports.js';

type Plain = Record<string, unknown>;

/** Datas viram ISO; nada de segredo sai daqui (hash de senha, tokens e cifras ficam de fora). */
const plain = (row: object): Plain => JSON.parse(JSON.stringify(row)) as Plain;

const OPEN_CONTRACTS = ['AWAITING_PAYMENT', 'ACTIVE', 'DISPUTED', 'APPROVED'] as const;
const CLOSED_PROJECTS = ['COMPLETED', 'CLOSED_BY_DISPUTE', 'CANCELLED', 'REJECTED'] as const;

export class DrizzlePersonalData implements PersonalData {
  constructor(private readonly ctx: DatabaseContext) {}

  async export(userId: string, email: string) {
    const db = this.ctx.executor;
    const party = or(eq(contracts.clientId, userId), eq(contracts.freelancerId, userId));
    const [
      [account],
      roles,
      providers,
      [client],
      [freelancer],
      stackRows,
      portfolio,
      history,
      [stats],
      projectRows,
      invitationRows,
      contractRows,
      deliveryRows,
      ratings,
      disputeRows,
      messageRows,
      fileRows,
      waitlist,
      security,
    ] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          status: users.status,
          emailVerifiedAt: users.emailVerifiedAt,
          termsAcceptedAt: users.termsAcceptedAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId)),
      db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId)),
      db
        .select({
          provider: authIdentities.provider,
          email: authIdentities.email,
          createdAt: authIdentities.createdAt,
        })
        .from(authIdentities)
        .where(eq(authIdentities.userId, userId)),
      db.select().from(clientProfiles).where(eq(clientProfiles.userId, userId)),
      db.select().from(freelancerProfiles).where(eq(freelancerProfiles.userId, userId)),
      db
        .select({ stack: freelancerStacks.stackSlug })
        .from(freelancerStacks)
        .where(eq(freelancerStacks.userId, userId)),
      db.select().from(portfolioItems).where(eq(portfolioItems.userId, userId)),
      db.select().from(levelChanges).where(eq(levelChanges.userId, userId)),
      db.select().from(freelancerStats).where(eq(freelancerStats.userId, userId)),
      db.select().from(projects).where(eq(projects.clientId, userId)),
      db.select().from(invitations).where(eq(invitations.freelancerId, userId)),
      db
        .select({
          id: contracts.id,
          projectId: contracts.projectId,
          role: sql<string>`case when ${contracts.clientId} = ${userId} then 'CLIENT' else 'FREELANCER' end`,
          status: contracts.status,
          proposalCents: contracts.proposalCents,
          clientTotalCents: contracts.clientTotalCents,
          freelancerNetCents: contracts.freelancerNetCents,
          platformFeeCents: contracts.platformFeeCents,
          deadlineDays: contracts.deadlineDays,
          fundedAt: contracts.fundedAt,
          approvedAt: contracts.approvedAt,
          releasedAt: contracts.releasedAt,
          createdAt: contracts.createdAt,
        })
        .from(contracts)
        .where(party),
      db
        .select({
          contractId: deliveries.contractId,
          number: deliveries.number,
          submittedAt: deliveries.submittedAt,
          message: deliveries.message,
          links: deliveries.links,
        })
        .from(deliveries)
        .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
        .where(eq(contracts.freelancerId, userId)),
      db
        .select()
        .from(contractRatings)
        .where(or(eq(contractRatings.clientId, userId), eq(contractRatings.freelancerId, userId))),
      db
        .select({
          id: disputes.id,
          contractId: disputes.contractId,
          kind: disputes.kind,
          status: disputes.status,
          openedByMe: sql<boolean>`${disputes.openerId} = ${userId}`,
          description: sql<
            string | null
          >`case when ${disputes.openerId} = ${userId} then ${disputes.description} end`,
          statements: disputes.statements,
          resolution: disputes.resolution,
          createdAt: disputes.createdAt,
        })
        .from(disputes)
        .innerJoin(contracts, eq(contracts.id, disputes.contractId))
        .where(party),
      db
        .select({
          conversationId: messages.conversationId,
          body: messages.body,
          masked: messages.masked,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.senderId, userId))
        .orderBy(desc(messages.createdAt)),
      db
        .select({
          id: files.id,
          fileName: files.fileName,
          contentType: files.contentType,
          size: files.size,
          purpose: files.purpose,
          status: files.status,
          createdAt: files.createdAt,
        })
        .from(files)
        .where(eq(files.ownerId, userId)),
      db.select().from(leads).where(eq(leads.email, email)),
      db
        .select({
          action: auditLog.action,
          ip: auditLog.ip,
          userAgent: auditLog.userAgent,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(eq(auditLog.actorId, userId))
        .orderBy(desc(auditLog.createdAt))
        .limit(500),
    ]);
    return {
      account: plain({ ...account, roles: roles.map((row) => row.role) }),
      loginProviders: providers.map(plain),
      clientProfile: client ? plain(client) : null,
      freelancerProfile: freelancer
        ? plain({ ...freelancer, stacks: stackRows.map((row) => row.stack) })
        : null,
      portfolio: portfolio.map(plain),
      levelHistory: history.map(plain),
      reputation: stats ? plain(stats) : null,
      projects: projectRows.map(plain),
      invitations: invitationRows.map(plain),
      contracts: contractRows.map((row) =>
        plain({ ...row, deliveries: deliveryRows.filter((d) => d.contractId === row.id) }),
      ),
      ratings: ratings.map(plain),
      disputes: disputeRows.map(({ statements, ...row }) =>
        plain({ ...row, myStatements: statements.filter((item) => item.userId === userId) }),
      ),
      messagesSent: messageRows.map(plain),
      files: fileRows.map(plain),
      waitlist: waitlist.map(plain),
      securityEvents: security.map(plain),
    };
  }

  async openObligations(userId: string) {
    const db = this.ctx.executor;
    const [[contractCount], [projectCount]] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(contracts)
        .where(
          and(
            or(eq(contracts.clientId, userId), eq(contracts.freelancerId, userId)),
            inArray(contracts.status, [...OPEN_CONTRACTS]),
          ),
        ),
      db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(projects)
        .where(
          and(eq(projects.clientId, userId), notInArray(projects.status, [...CLOSED_PROJECTS])),
        ),
    ]);
    return { contracts: contractCount?.total ?? 0, projects: projectCount?.total ?? 0 };
  }
}

export class DrizzleRetention implements Retention {
  constructor(private readonly ctx: DatabaseContext) {}

  async purgeViolationOriginals(before: Date): Promise<number> {
    const rows = await this.ctx.executor
      .update(contactViolations)
      .set({ originalEncrypted: '' })
      .where(
        and(lt(contactViolations.createdAt, before), ne(contactViolations.originalEncrypted, '')),
      )
      .returning({ id: contactViolations.id });
    return rows.length;
  }

  async purgeOneTimeTokens(before: Date): Promise<number> {
    const rows = await this.ctx.executor
      .delete(oneTimeTokens)
      .where(lt(oneTimeTokens.expiresAt, before))
      .returning({ id: oneTimeTokens.id });
    return rows.length;
  }

  async purgeRefreshTokens(before: Date): Promise<number> {
    const rows = await this.ctx.executor
      .delete(refreshTokens)
      .where(
        or(
          lt(refreshTokens.expiresAt, before),
          and(isNotNull(refreshTokens.revokedAt), lt(refreshTokens.revokedAt, before)),
        ),
      )
      .returning({ id: refreshTokens.id });
    return rows.length;
  }

  async purgePublishedOutbox(before: Date): Promise<number> {
    const rows = await this.ctx.executor
      .delete(outboxEvents)
      .where(and(isNotNull(outboxEvents.publishedAt), lt(outboxEvents.publishedAt, before)))
      .returning({ id: outboxEvents.id });
    return rows.length;
  }

  async purgeWebhookEvents(before: Date): Promise<number> {
    const rows = await this.ctx.executor
      .delete(webhookEvents)
      .where(lt(webhookEvents.receivedAt, before))
      .returning({ eventId: webhookEvents.eventId });
    return rows.length;
  }
}
