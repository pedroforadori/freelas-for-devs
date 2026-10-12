import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  contractRatings,
  contracts,
  deliveries,
  ledgerEntries,
  payments,
  payoutAccounts,
  webhookEvents,
} from '../../../db/schema/contracts.js';
import { users } from '../../../db/schema/identity.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import {
  appendToOutbox,
  assignEventIds,
} from '../../../shared/infra/outbox/drizzle-outbox.store.js';
import { ConcurrencyError } from '../../../shared/kernel/domain-error.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type {
  ContractRepository,
  Ledger,
  LedgerEntryView,
  RatingRecord,
  Ratings,
  PaymentRepository,
  PayoutAccountRecord,
  PayoutAccounts,
  PeopleDirectory,
  WebhookInbox,
} from '../application/ports.js';
import { Contract, type DeliveryRecord } from '../domain/contract.js';
import type { Journal, LedgerAccount } from '../domain/ledger.js';
import { Payment } from '../domain/payment.js';

type ContractRow = typeof contracts.$inferSelect;

const toContract = (row: ContractRow, deliveryRows: DeliveryRecord[]): Contract =>
  Contract.rehydrate({
    id: row.id,
    projectId: row.projectId,
    invitationId: row.invitationId,
    clientId: row.clientId,
    freelancerId: row.freelancerId,
    status: row.status,
    amounts: {
      proposalCents: row.proposalCents,
      platformFeeCents: row.platformFeeCents,
      commissionBps: row.commissionBps,
      commissionPayer: row.commissionPayer,
      clientTotalCents: row.clientTotalCents,
      freelancerNetCents: row.freelancerNetCents,
    },
    deadlineDays: row.deadlineDays,
    paymentDeadlineAt: row.paymentDeadlineAt,
    fundedAt: row.fundedAt,
    closedAt: row.closedAt,
    stage: row.stage,
    dueAt: row.dueAt,
    deliveryParams: row.deliveryParams,
    correctionsUsed: row.correctionsUsed,
    deliveries: deliveryRows,
    approvedAt: row.approvedAt,
    approvalKind: row.approvalKind,
    releasedAt: row.releasedAt,
    transferRef: row.transferRef,
    holds: row.holds,
    pausedAt: row.pausedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

export class DrizzleContractRepository implements ContractRepository {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  private async hydrate(rows: ContractRow[]): Promise<Contract[]> {
    if (rows.length === 0) return [];
    const deliveryRows = await this.ctx.executor
      .select()
      .from(deliveries)
      .where(
        inArray(
          deliveries.contractId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(deliveries.submittedAt));
    return rows.map((row) =>
      toContract(
        row,
        deliveryRows
          .filter((delivery) => delivery.contractId === row.id)
          .map(({ contractId: _contract, ...delivery }) => delivery),
      ),
    );
  }

  private async one(where: ReturnType<typeof eq>): Promise<Contract | null> {
    const rows = await this.ctx.executor.select().from(contracts).where(where).limit(1);
    return (await this.hydrate(rows))[0] ?? null;
  }

  find(id: string) {
    return this.one(eq(contracts.id, id));
  }

  findByInvitation(invitationId: string) {
    return this.one(eq(contracts.invitationId, invitationId));
  }

  async findLatestByProject(projectId: string): Promise<Contract | null> {
    const rows = await this.ctx.executor
      .select()
      .from(contracts)
      .where(eq(contracts.projectId, projectId))
      .orderBy(desc(contracts.createdAt), desc(contracts.id))
      .limit(1);
    return (await this.hydrate(rows))[0] ?? null;
  }

  async reviewsPastDeadline(now: Date, limit: number): Promise<string[]> {
    const rows = await this.ctx.executor
      .selectDistinct({ id: contracts.id })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .where(
        and(
          eq(contracts.status, 'ACTIVE'),
          // Prazos pausados (fora de escopo pendente) não vencem.
          isNull(contracts.pausedAt),
          isNull(deliveries.reviewedAt),
          lte(deliveries.reviewDeadlineAt, now),
        ),
      )
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async approvedUnreleased(input: { freelancerId?: string; limit: number }): Promise<string[]> {
    const rows = await this.ctx.executor
      .select({ id: contracts.id })
      .from(contracts)
      .where(
        and(
          eq(contracts.status, 'APPROVED'),
          input.freelancerId ? eq(contracts.freelancerId, input.freelancerId) : undefined,
        ),
      )
      .orderBy(asc(contracts.approvedAt))
      .limit(input.limit);
    return rows.map((row) => row.id);
  }

  async listForUser(userId: string, limit: number): Promise<Contract[]> {
    const rows = await this.ctx.executor
      .select()
      .from(contracts)
      .where(or(eq(contracts.clientId, userId), eq(contracts.freelancerId, userId)))
      .orderBy(desc(contracts.updatedAt))
      .limit(limit);
    return this.hydrate(rows);
  }

  async awaitingPaymentPastDeadline(now: Date, limit: number): Promise<string[]> {
    const rows = await this.ctx.executor
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.status, 'AWAITING_PAYMENT'), lte(contracts.paymentDeadlineAt, now)))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  save(contract: Contract): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.executor;
      const s = contract.toSnapshot();
      const row = {
        status: s.status,
        fundedAt: s.fundedAt,
        closedAt: s.closedAt,
        stage: s.stage,
        dueAt: s.dueAt,
        deliveryParams: s.deliveryParams,
        correctionsUsed: s.correctionsUsed,
        approvedAt: s.approvedAt,
        approvalKind: s.approvalKind,
        releasedAt: s.releasedAt,
        transferRef: s.transferRef,
        holds: s.holds,
        pausedAt: s.pausedAt,
        // Adicionais fora de escopo pagos somam aos valores do contrato.
        proposalCents: s.amounts.proposalCents,
        platformFeeCents: s.amounts.platformFeeCents,
        clientTotalCents: s.amounts.clientTotalCents,
        freelancerNetCents: s.amounts.freelancerNetCents,
        updatedAt: s.updatedAt,
      };
      if (s.version === 0) {
        await db.insert(contracts).values({
          ...row,
          id: s.id,
          projectId: s.projectId,
          invitationId: s.invitationId,
          clientId: s.clientId,
          freelancerId: s.freelancerId,
          deadlineDays: s.deadlineDays,
          commissionBps: s.amounts.commissionBps,
          commissionPayer: s.amounts.commissionPayer,
          paymentDeadlineAt: s.paymentDeadlineAt,
          createdAt: s.createdAt,
          version: 1,
        });
      } else {
        const updated = await db
          .update(contracts)
          .set({ ...row, version: s.version + 1 })
          .where(and(eq(contracts.id, s.id), eq(contracts.version, s.version)))
          .returning({ id: contracts.id });
        if (updated.length === 0) throw new ConcurrencyError('Contract', s.id);
      }
      // Entregas: inserção ou atualização da revisão (chave: contrato + número + envio).
      for (const delivery of s.deliveries) {
        const values = {
          // Estendido quando os prazos voltam a correr depois de uma pausa.
          reviewDeadlineAt: delivery.reviewDeadlineAt,
          reviewedAt: delivery.reviewedAt,
          outcome: delivery.outcome,
          adjustments: delivery.adjustments,
          correction: delivery.correction,
        };
        await db
          .insert(deliveries)
          .values({ ...delivery, contractId: s.id })
          .onConflictDoUpdate({
            target: [deliveries.contractId, deliveries.number, deliveries.submittedAt],
            set: values,
          });
      }
      await appendToOutbox(db, assignEventIds(contract.pullEvents(), this.ids));
      contract.markPersisted();
    });
  }
}

export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(private readonly ctx: DatabaseContext) {}

  async findByCheckout(provider: string, checkoutId: string): Promise<Payment | null> {
    const [row] = await this.ctx.executor
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.providerCheckoutId, checkoutId)))
      .limit(1);
    return row ? Payment.rehydrate(row) : null;
  }

  async listByContract(contractId: string): Promise<Payment[]> {
    const rows = await this.ctx.executor
      .select()
      .from(payments)
      .where(eq(payments.contractId, contractId))
      .orderBy(asc(payments.createdAt), asc(payments.id));
    return rows.map((row) => Payment.rehydrate(row));
  }

  async pendingCreatedBefore(date: Date, limit: number): Promise<Payment[]> {
    const rows = await this.ctx.executor
      .select()
      .from(payments)
      .where(and(eq(payments.status, 'PENDING'), lte(payments.createdAt, date)))
      .orderBy(asc(payments.createdAt))
      .limit(limit);
    return rows.map((row) => Payment.rehydrate(row));
  }

  async save(payment: Payment): Promise<void> {
    const db = this.ctx.executor;
    const { version, ...s } = payment.toSnapshot();
    if (version === 0) {
      await db.insert(payments).values({ ...s, version: 1 });
      return;
    }
    const updated = await db
      .update(payments)
      .set({
        status: s.status,
        providerPaymentRef: s.providerPaymentRef,
        succeededAt: s.succeededAt,
        refundedAt: s.refundedAt,
        refundedCents: s.refundedCents,
        updatedAt: s.updatedAt,
        version: version + 1,
      })
      .where(and(eq(payments.id, s.id), eq(payments.version, version)))
      .returning({ id: payments.id });
    if (updated.length === 0) throw new ConcurrencyError('Payment', s.id);
  }
}

export class DrizzleLedger implements Ledger {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  async append(journal: Journal): Promise<void> {
    await this.ctx.executor.insert(ledgerEntries).values(
      journal.lines.map((line) => ({
        id: this.ids.next(),
        journalId: journal.id,
        contractId: journal.contractId,
        kind: journal.kind,
        account: line.account,
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        reference: journal.reference,
        createdAt: journal.createdAt,
      })),
    );
  }

  entries(contractId: string): Promise<LedgerEntryView[]> {
    return this.ctx.executor
      .select({
        journalId: ledgerEntries.journalId,
        kind: ledgerEntries.kind,
        account: ledgerEntries.account,
        debitCents: ledgerEntries.debitCents,
        creditCents: ledgerEntries.creditCents,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.contractId, contractId))
      .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));
  }

  async balance(contractId: string, account: LedgerAccount): Promise<number> {
    const [row] = await this.ctx.executor
      .select({
        balance:
          sql`coalesce(sum(${ledgerEntries.creditCents} - ${ledgerEntries.debitCents}), 0)`.mapWith(
            Number,
          ),
      })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.contractId, contractId), eq(ledgerEntries.account, account)));
    return row?.balance ?? 0;
  }
}

export class DrizzleWebhookInbox implements WebhookInbox {
  constructor(private readonly ctx: DatabaseContext) {}

  async recordOnce(provider: string, eventId: string, type: string, now: Date): Promise<boolean> {
    const inserted = await this.ctx.executor
      .insert(webhookEvents)
      .values({ provider, eventId, type, receivedAt: now })
      .onConflictDoNothing()
      .returning({ eventId: webhookEvents.eventId });
    return inserted.length > 0;
  }
}

export class DrizzlePayoutAccounts implements PayoutAccounts {
  constructor(private readonly ctx: DatabaseContext) {}

  async find(userId: string): Promise<PayoutAccountRecord | null> {
    const [row] = await this.ctx.executor
      .select()
      .from(payoutAccounts)
      .where(eq(payoutAccounts.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async findByProviderAccount(provider: string, accountId: string) {
    const [row] = await this.ctx.executor
      .select()
      .from(payoutAccounts)
      .where(
        and(eq(payoutAccounts.provider, provider), eq(payoutAccounts.providerAccountId, accountId)),
      )
      .limit(1);
    return row ?? null;
  }

  async save(record: PayoutAccountRecord, now: Date): Promise<void> {
    await this.ctx.executor
      .insert(payoutAccounts)
      .values({ ...record, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: payoutAccounts.userId,
        set: {
          detailsSubmitted: record.detailsSubmitted,
          payoutsEnabled: record.payoutsEnabled,
          updatedAt: now,
        },
      });
  }
}

export class DrizzleContractPeople implements PeopleDirectory {
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

export class DrizzleRatings implements Ratings {
  constructor(private readonly ctx: DatabaseContext) {}

  async find(contractId: string): Promise<RatingRecord | null> {
    const [row] = await this.ctx.executor
      .select()
      .from(contractRatings)
      .where(eq(contractRatings.contractId, contractId))
      .limit(1);
    return row ?? null;
  }

  async create(record: RatingRecord): Promise<boolean> {
    const inserted = await this.ctx.executor
      .insert(contractRatings)
      .values(record)
      .onConflictDoNothing()
      .returning({ contractId: contractRatings.contractId });
    return inserted.length > 0;
  }
}
