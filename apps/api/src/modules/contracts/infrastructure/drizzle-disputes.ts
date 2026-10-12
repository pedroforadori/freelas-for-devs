import type { AdminDisputeSummary, UserContractStats } from '@f4d/contracts';
import { aliasedTable, and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { contracts, disputes, outOfScopeRequests } from '../../../db/schema/contracts.js';
import { users } from '../../../db/schema/identity.js';
import { projects } from '../../../db/schema/projects.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import {
  appendToOutbox,
  assignEventIds,
} from '../../../shared/infra/outbox/drizzle-outbox.store.js';
import { ConcurrencyError } from '../../../shared/kernel/domain-error.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type {
  DisputeQueries,
  DisputeRepository,
  OutOfScopeRepository,
} from '../application/ports.js';
import { Dispute } from '../domain/dispute.js';
import { OutOfScopeRequest } from '../domain/out-of-scope.js';

const iso = (date: Date | null) => date?.toISOString() ?? null;
const date = (value: string | null) => (value ? new Date(value) : null);

type OutOfScopeRow = typeof outOfScopeRequests.$inferSelect;
type DisputeRow = typeof disputes.$inferSelect;

const toRequest = (row: OutOfScopeRow, commission: { bps: number; payer: string }) =>
  OutOfScopeRequest.rehydrate({
    id: row.id,
    contractId: row.contractId,
    status: row.status,
    description: row.description,
    amounts: {
      proposalCents: row.proposalCents,
      platformFeeCents: row.platformFeeCents,
      commissionBps: commission.bps,
      commissionPayer: commission.payer as 'CLIENT' | 'FREELANCER' | 'SPLIT',
      clientTotalCents: row.clientTotalCents,
      freelancerNetCents: row.freelancerNetCents,
    },
    extraDays: row.extraDays,
    contestReason: row.contestReason,
    ruling: row.ruling ? { ...row.ruling, decidedAt: new Date(row.ruling.decidedAt) } : null,
    paymentDeadlineAt: row.paymentDeadlineAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

export class DrizzleOutOfScopeRepository implements OutOfScopeRepository {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  private select() {
    return this.ctx.executor
      .select({
        row: outOfScopeRequests,
        bps: contracts.commissionBps,
        payer: contracts.commissionPayer,
      })
      .from(outOfScopeRequests)
      .innerJoin(contracts, eq(contracts.id, outOfScopeRequests.contractId));
  }

  async find(id: string): Promise<OutOfScopeRequest | null> {
    const [found] = await this.select().where(eq(outOfScopeRequests.id, id)).limit(1);
    return found ? toRequest(found.row, found) : null;
  }

  async listByContract(contractId: string): Promise<OutOfScopeRequest[]> {
    const rows = await this.select()
      .where(eq(outOfScopeRequests.contractId, contractId))
      .orderBy(asc(outOfScopeRequests.createdAt), asc(outOfScopeRequests.id));
    return rows.map((found) => toRequest(found.row, found));
  }

  async awaitingPaymentPastDeadline(now: Date, limit: number): Promise<string[]> {
    const rows = await this.ctx.executor
      .select({ id: outOfScopeRequests.id })
      .from(outOfScopeRequests)
      .where(
        and(
          eq(outOfScopeRequests.status, 'ACCEPTED_AWAITING_PAYMENT'),
          lte(outOfScopeRequests.paymentDeadlineAt, now),
        ),
      )
      .limit(limit);
    return rows.map((row) => row.id);
  }

  save(request: OutOfScopeRequest): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.executor;
      const { version, ruling, amounts, ...s } = request.toSnapshot();
      const row = {
        status: s.status,
        contestReason: s.contestReason,
        ruling: ruling ? { ...ruling, decidedAt: ruling.decidedAt.toISOString() } : null,
        paymentDeadlineAt: s.paymentDeadlineAt,
        updatedAt: s.updatedAt,
      };
      if (version === 0) {
        await db.insert(outOfScopeRequests).values({
          ...row,
          id: s.id,
          contractId: s.contractId,
          description: s.description,
          proposalCents: amounts.proposalCents,
          platformFeeCents: amounts.platformFeeCents,
          clientTotalCents: amounts.clientTotalCents,
          freelancerNetCents: amounts.freelancerNetCents,
          extraDays: s.extraDays,
          createdAt: s.createdAt,
          version: 1,
        });
      } else {
        const updated = await db
          .update(outOfScopeRequests)
          .set({ ...row, version: version + 1 })
          .where(and(eq(outOfScopeRequests.id, s.id), eq(outOfScopeRequests.version, version)))
          .returning({ id: outOfScopeRequests.id });
        if (updated.length === 0) throw new ConcurrencyError('OutOfScopeRequest', s.id);
      }
      await appendToOutbox(db, assignEventIds(request.pullEvents(), this.ids));
      request.markPersisted();
    });
  }
}

const toDispute = (row: DisputeRow): Dispute =>
  Dispute.rehydrate({
    ...row,
    statements: row.statements.map((item) => ({ ...item, createdAt: new Date(item.createdAt) })),
    resolution: row.resolution
      ? { ...row.resolution, decidedAt: new Date(row.resolution.decidedAt) }
      : null,
    execution: { ...row.execution, refundedAt: date(row.execution.refundedAt) },
  });

const ACTIVE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'EXECUTING'] as const;

export class DrizzleDisputeRepository implements DisputeRepository {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  async find(id: string): Promise<Dispute | null> {
    const [row] = await this.ctx.executor.select().from(disputes).where(eq(disputes.id, id));
    return row ? toDispute(row) : null;
  }

  async findActiveByContract(contractId: string): Promise<Dispute | null> {
    const [row] = await this.ctx.executor
      .select()
      .from(disputes)
      .where(
        and(eq(disputes.contractId, contractId), inArray(disputes.status, [...ACTIVE_STATUSES])),
      )
      .limit(1);
    return row ? toDispute(row) : null;
  }

  async findLatestByContract(contractId: string): Promise<Dispute | null> {
    const [row] = await this.ctx.executor
      .select()
      .from(disputes)
      .where(eq(disputes.contractId, contractId))
      .orderBy(desc(disputes.createdAt), desc(disputes.id))
      .limit(1);
    return row ? toDispute(row) : null;
  }

  async openPastEvidenceDeadline(now: Date, limit: number): Promise<string[]> {
    const rows = await this.ctx.executor
      .select({ id: disputes.id })
      .from(disputes)
      .where(and(eq(disputes.status, 'OPEN'), lte(disputes.evidenceDeadlineAt, now)))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async executing(limit: number): Promise<string[]> {
    const rows = await this.ctx.executor
      .select({ id: disputes.id })
      .from(disputes)
      .where(eq(disputes.status, 'EXECUTING'))
      .orderBy(asc(disputes.updatedAt))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  save(dispute: Dispute): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.executor;
      const { version, ...s } = dispute.toSnapshot();
      const row = {
        status: s.status,
        statements: s.statements.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
        })),
        resolution: s.resolution
          ? { ...s.resolution, decidedAt: s.resolution.decidedAt.toISOString() }
          : null,
        execution: { ...s.execution, refundedAt: iso(s.execution.refundedAt) },
        closedAt: s.closedAt,
        updatedAt: s.updatedAt,
      };
      if (version === 0) {
        await db.insert(disputes).values({
          ...row,
          id: s.id,
          contractId: s.contractId,
          kind: s.kind,
          openedBy: s.openedBy,
          openerId: s.openerId,
          reason: s.reason,
          description: s.description,
          evidenceDeadlineAt: s.evidenceDeadlineAt,
          createdAt: s.createdAt,
          version: 1,
        });
      } else {
        const updated = await db
          .update(disputes)
          .set({ ...row, evidenceDeadlineAt: s.evidenceDeadlineAt, version: version + 1 })
          .where(and(eq(disputes.id, s.id), eq(disputes.version, version)))
          .returning({ id: disputes.id });
        if (updated.length === 0) throw new ConcurrencyError('Dispute', s.id);
      }
      await appendToOutbox(db, assignEventIds(dispute.pullEvents(), this.ids));
      dispute.markPersisted();
    });
  }
}

const clientUser = aliasedTable(users, 'client_user');
const freelancerUser = aliasedTable(users, 'freelancer_user');
const count = (condition: ReturnType<typeof sql>) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

export class DrizzleDisputeQueries implements DisputeQueries {
  constructor(private readonly ctx: DatabaseContext) {}

  async adminList(view: 'open' | 'closed'): Promise<AdminDisputeSummary[]> {
    const open = view === 'open';
    const rows = await this.ctx.executor
      .select({
        dispute: disputes,
        projectId: projects.id,
        projectTitle: projects.title,
        clientId: contracts.clientId,
        clientName: clientUser.displayName,
        freelancerId: contracts.freelancerId,
        freelancerName: freelancerUser.displayName,
        clientTotalCents: contracts.clientTotalCents,
      })
      .from(disputes)
      .innerJoin(contracts, eq(contracts.id, disputes.contractId))
      .innerJoin(projects, eq(projects.id, contracts.projectId))
      .innerJoin(clientUser, eq(clientUser.id, contracts.clientId))
      .innerJoin(freelancerUser, eq(freelancerUser.id, contracts.freelancerId))
      .where(inArray(disputes.status, open ? [...ACTIVE_STATUSES] : ['CLOSED', 'WITHDRAWN']))
      .orderBy(open ? asc(disputes.createdAt) : desc(disputes.createdAt))
      .limit(100);
    return rows.map((row) => ({
      id: row.dispute.id,
      kind: row.dispute.kind,
      status: row.dispute.status,
      reason: row.dispute.reason,
      openedBy: row.dispute.openedBy,
      contractId: row.dispute.contractId,
      project: { id: row.projectId, title: row.projectTitle },
      client: { userId: row.clientId, displayName: row.clientName },
      freelancer: { userId: row.freelancerId, displayName: row.freelancerName },
      clientTotalCents: row.clientTotalCents,
      evidenceDeadlineAt: row.dispute.evidenceDeadlineAt.toISOString(),
      statements: row.dispute.statements.length,
      waitingFor: row.dispute.execution.waitingFor,
      createdAt: row.dispute.createdAt.toISOString(),
    }));
  }

  async userStats(userId: string): Promise<UserContractStats> {
    const db = this.ctx.executor;
    const started = sql`${contracts.status} not in ('AWAITING_PAYMENT', 'EXPIRED', 'CANCELLED')`;
    const completed = sql`${contracts.status} in ('APPROVED', 'RELEASED')`;
    const settled = sql`${contracts.status} = 'SETTLED'`;
    const side = async (column: typeof contracts.clientId | typeof contracts.freelancerId) => {
      const [row] = await db
        .select({
          contracts: count(started),
          completed: count(completed),
          settledByMediation: count(settled),
        })
        .from(contracts)
        .where(eq(column, userId));
      return row ?? { contracts: 0, completed: 0, settledByMediation: 0 };
    };
    const [asClient, asFreelancer] = await Promise.all([
      side(contracts.clientId),
      side(contracts.freelancerId),
    ]);
    const [opened] = await db
      .select({
        asClient: count(sql`${disputes.openedBy} = 'CLIENT'`),
        asFreelancer: count(
          sql`${disputes.openedBy} = 'FREELANCER' and ${disputes.kind} = 'DISPUTE'`,
        ),
      })
      .from(disputes)
      .where(and(eq(disputes.openerId, userId), eq(disputes.kind, 'DISPUTE')));
    const [freelancerDisputes] = await db
      .select({
        abandonments: count(sql`${disputes.kind} = 'ABANDONMENT'`),
        averageShareBps: sql<
          number | null
        >`round(avg((${disputes.resolution} ->> 'freelancerShareBps')::int))`.mapWith((value) =>
          value === null ? null : Number(value),
        ),
      })
      .from(disputes)
      .innerJoin(contracts, eq(contracts.id, disputes.contractId))
      .where(eq(contracts.freelancerId, userId));
    const [scope] = await db
      .select({
        flagged: sql<number>`count(*)`.mapWith(Number),
        ruledInScope: count(sql`${outOfScopeRequests.status} = 'RULED_IN_SCOPE'`),
      })
      .from(outOfScopeRequests)
      .innerJoin(contracts, eq(contracts.id, outOfScopeRequests.contractId))
      .where(eq(contracts.freelancerId, userId));
    return {
      asClient: { ...asClient, disputesOpened: opened?.asClient ?? 0 },
      asFreelancer: {
        ...asFreelancer,
        disputesOpened: opened?.asFreelancer ?? 0,
        abandonments: freelancerDisputes?.abandonments ?? 0,
        outOfScopeFlagged: scope?.flagged ?? 0,
        outOfScopeRuledInScope: scope?.ruledInScope ?? 0,
        averageShareBps: freelancerDisputes?.averageShareBps ?? null,
      },
    };
  }
}
