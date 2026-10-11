import type { CommissionPayer, ContractStatus, DeliveryStage, PaymentStatus } from '@f4d/contracts';
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
