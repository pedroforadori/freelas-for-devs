import type { CommissionPayer, ContractStatus, PaymentStatus } from '@f4d/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
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
  ],
);

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
    kind: text().$type<'FUNDING' | 'REFUND' | 'RELEASE'>().notNull(),
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
