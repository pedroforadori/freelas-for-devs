import type {
  CommissionPayer,
  ContractStatus,
  DeliveryStage,
  DisputeReason,
  DisputeStatus,
  OutOfScopeStatus,
  PaymentStatus,
} from '@f4d/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { invitations } from './distribution.js';
import { users } from './identity.js';
import { projects } from './projects.js';

/** Contrato criado na escolha da proposta; valores e comissão são snapshot (ADR-0012). */
export const contracts = pgTable(
  'contracts',
  {
    id: uuid().primaryKey(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    invitationId: uuid()
      .notNull()
      .references(() => invitations.id),
    clientId: uuid()
      .notNull()
      .references(() => users.id),
    freelancerId: uuid()
      .notNull()
      .references(() => users.id),
    status: text().$type<ContractStatus>().notNull(),
    proposalCents: integer().notNull(),
    deadlineDays: integer().notNull(),
    commissionBps: integer().notNull(),
    commissionPayer: text().$type<CommissionPayer>().notNull(),
    platformFeeCents: integer().notNull(),
    clientTotalCents: integer().notNull(),
    freelancerNetCents: integer().notNull(),
    paymentDeadlineAt: timestamp({ withTimezone: true }).notNull(),
    fundedAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    /** Etapa das entregas enquanto ACTIVE. */
    stage: text().$type<DeliveryStage>(),
    dueAt: timestamp({ withTimezone: true }),
    /** Prazos de revisão e limite de correções, copiados das configurações no pagamento. */
    deliveryParams: jsonb().$type<{
      reviewDays: number;
      autoApproveDays: number;
      maxCorrections: number;
    }>(),
    correctionsUsed: integer().notNull().default(0),
    approvedAt: timestamp({ withTimezone: true }),
    approvalKind: text().$type<'CLIENT' | 'AUTO'>(),
    releasedAt: timestamp({ withTimezone: true }),
    /** Transferência ao freelancer no provedor (repasse). */
    transferRef: text(),
    /** Travas que pausam os prazos (fora de escopo pendente, disputa) e desde quando. */
    holds: jsonb().$type<string[]>().notNull().default([]),
    pausedAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    // Uma escolha gera um único contrato (evento repetido não duplica).
    uniqueIndex('contracts_invitation_key').on(table.invitationId),
    index('contracts_project_idx').on(table.projectId, table.createdAt),
    // Reconciliador de prazos de pagamento.
    index('contracts_payment_deadline_idx').on(table.status, table.paymentDeadlineAt),
    index('contracts_client_idx').on(table.clientId, table.updatedAt),
    index('contracts_freelancer_idx').on(table.freelancerId, table.updatedAt),
  ],
);

/** Entregas do contrato (1, 2 e final), com a revisão do cliente. */
export const deliveries = pgTable(
  'deliveries',
  {
    contractId: uuid()
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    number: integer().notNull(),
    submittedAt: timestamp({ withTimezone: true }).notNull(),
    message: text().notNull(),
    links: jsonb().$type<string[]>().notNull().default([]),
    attachmentIds: jsonb().$type<string[]>().notNull().default([]),
    reviewDeadlineAt: timestamp({ withTimezone: true }).notNull(),
    reviewedAt: timestamp({ withTimezone: true }),
    outcome: text().$type<
      'ADJUSTMENTS' | 'APPROVED' | 'TIMEOUT' | 'CORRECTION' | 'AUTO_APPROVED'
    >(),
    adjustments: jsonb().$type<{ id: string; text: string }[]>().notNull().default([]),
    correction: jsonb().$type<{ adjustmentIds: string[]; note: string | null }>(),
  },
  (table) => [
    primaryKey({ columns: [table.contractId, table.number, table.submittedAt] }),
    // Reconciliador de prazos de revisão.
    index('deliveries_review_deadline_idx').on(table.reviewedAt, table.reviewDeadlineAt),
  ],
);

/** Avaliação do cliente sobre o trabalho (uma por contrato); base da reputação (F9). */
export const contractRatings = pgTable('contract_ratings', {
  contractId: uuid()
    .primaryKey()
    .references(() => contracts.id, { onDelete: 'cascade' }),
  freelancerId: uuid()
    .notNull()
    .references(() => users.id),
  clientId: uuid()
    .notNull()
    .references(() => users.id),
  rating: integer().notNull(),
  comment: text(),
  createdAt: timestamp({ withTimezone: true }).notNull(),
});

/** Cada tentativa de pagamento (um checkout do provedor). */
export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id),
    provider: text().notNull(),
    providerCheckoutId: text().notNull(),
    /** Referência da cobrança no provedor (PaymentIntent), usada no reembolso e no repasse. */
    providerPaymentRef: text(),
    checkoutUrl: text().notNull(),
    checkoutExpiresAt: timestamp({ withTimezone: true }).notNull(),
    status: text().$type<PaymentStatus>().notNull(),
    amountCents: integer().notNull(),
    /** Devolvido ao cliente (parcial numa disputa). */
    refundedCents: integer().notNull().default(0),
    /** Pagamento de um adicional fora de escopo (nulo = valor do contrato). */
    outOfScopeId: uuid().references(() => outOfScopeRequests.id),
    succeededAt: timestamp({ withTimezone: true }),
    refundedAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('payments_provider_checkout_key').on(table.provider, table.providerCheckoutId),
    index('payments_contract_idx').on(table.contractId),
    index('payments_pending_idx')
      .on(table.status, table.createdAt)
      .where(sql`${table.status} = 'PENDING'`),
  ],
);

/**
 * Razão contábil em partidas dobradas: cada lançamento (journal) tem linhas cuja soma de débitos
 * é igual à de créditos. Valores sempre em centavos inteiros. Nunca alterado, só acrescentado.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid().primaryKey(),
    journalId: uuid().notNull(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id),
    kind: text().$type<'FUNDING' | 'REFUND' | 'RELEASE' | 'PAYOUT'>().notNull(),
    account: text().notNull(),
    debitCents: integer().notNull().default(0),
    creditCents: integer().notNull().default(0),
    reference: text(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    index('ledger_entries_contract_idx').on(table.contractId, table.account),
    index('ledger_entries_journal_idx').on(table.journalId),
  ],
);

/** Idempotência de webhooks: um evento do provedor é processado uma única vez. */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    provider: text().notNull(),
    eventId: text().notNull(),
    type: text().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex('webhook_events_key').on(table.provider, table.eventId)],
);

/** Conta do freelancer no provedor (Stripe Connect Express) para receber os repasses. */
export const payoutAccounts = pgTable(
  'payout_accounts',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    detailsSubmitted: boolean().notNull().default(false),
    payoutsEnabled: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('payout_accounts_provider_key').on(table.provider, table.providerAccountId),
  ],
);

/** Pedido fora do escopo aprovado (docs/architecture.md §4.4), com o adicional já com comissão. */
export const outOfScopeRequests = pgTable(
  'out_of_scope_requests',
  {
    id: uuid().primaryKey(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id),
    status: text().$type<OutOfScopeStatus>().notNull(),
    description: text().notNull(),
    proposalCents: integer().notNull(),
    platformFeeCents: integer().notNull(),
    clientTotalCents: integer().notNull(),
    freelancerNetCents: integer().notNull(),
    extraDays: integer().notNull(),
    contestReason: text(),
    ruling: jsonb().$type<{
      decision: 'IN_SCOPE' | 'OUT_OF_SCOPE';
      note: string;
      adminId: string;
      decidedAt: string;
    }>(),
    paymentDeadlineAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    index('out_of_scope_contract_idx').on(table.contractId, table.createdAt),
    // Reconciliador: adicionais aceitos e não pagos no prazo.
    index('out_of_scope_payment_deadline_idx').on(table.status, table.paymentDeadlineAt),
  ],
);

/** Disputa do contrato (docs/architecture.md §4.5); abandono é uma disputa do tipo ABANDONMENT. */
export const disputes = pgTable(
  'disputes',
  {
    id: uuid().primaryKey(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id),
    kind: text().$type<'DISPUTE' | 'ABANDONMENT'>().notNull(),
    status: text().$type<DisputeStatus>().notNull(),
    openedBy: text().$type<'CLIENT' | 'FREELANCER' | 'ADMIN'>().notNull(),
    openerId: uuid()
      .notNull()
      .references(() => users.id),
    reason: text().$type<DisputeReason>().notNull(),
    description: text().notNull(),
    evidenceDeadlineAt: timestamp({ withTimezone: true }).notNull(),
    statements: jsonb()
      .$type<
        {
          role: 'CLIENT' | 'FREELANCER';
          userId: string;
          text: string;
          attachmentIds: string[];
          createdAt: string;
        }[]
      >()
      .notNull()
      .default([]),
    resolution: jsonb().$type<{
      freelancerShareBps: number;
      note: string;
      adminId: string;
      freelancerCents: number;
      platformFeeCents: number;
      refundCents: number;
      decidedAt: string;
    }>(),
    execution: jsonb()
      .$type<{ refundedAt: string | null; transferRef: string | null; waitingFor: string | null }>()
      .notNull(),
    closedAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    index('disputes_contract_idx').on(table.contractId, table.createdAt),
    // Uma disputa ativa por contrato (aberturas concorrentes não duplicam).
    uniqueIndex('disputes_active_contract_key')
      .on(table.contractId)
      .where(sql`${table.status} in ('OPEN', 'UNDER_REVIEW', 'EXECUTING')`),
    index('disputes_status_idx').on(table.status, table.evidenceDeadlineAt),
  ],
);
