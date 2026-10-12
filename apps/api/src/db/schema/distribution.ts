import type {
  InvitationStatus,
  QueueState,
  QueueTier,
  SelectionFeedbackReason,
} from '@f4d/contracts';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { levels } from './catalog.js';
import { users } from './identity.js';
import type { RoundParams } from '../../modules/distribution/domain/round.js';
import { projects } from './projects.js';

/**
 * Posição de cada freelancer aprovado na fila do seu nível (docs/architecture.md §6). A ordem de
 * convite sai daqui: prioridade primeiro (quem espera há mais tempo), depois round-robin.
 */
export const queueEntries = pgTable(
  'queue_entries',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    levelSlug: text()
      .notNull()
      .references(() => levels.slug),
    state: text().$type<QueueState>().notNull().default('ACTIVE'),
    tier: text().$type<QueueTier>().notNull().default('NORMAL'),
    prioritySince: timestamp({ withTimezone: true }),
    /** Nulo = nunca convidado (vai à frente dos demais NORMAL). */
    lastInvitedAt: timestamp({ withTimezone: true }),
    roundsWithoutSelection: integer().notNull().default(0),
    openInvitations: integer().notNull().default(0),
    declines: integer().notNull().default(0),
    noResponses: integer().notNull().default(0),
    selections: integer().notNull().default(0),
    /** Desempenho (0 a 1; 0,5 neutro), atualizado pela reputação: ajusta a vez na fila. */
    score: real().notNull().default(0.5),
    /** Contratos abandonados (penalidade na fila; entra na reputação da F9). */
    abandonments: integer().notNull().default(0),
    monitoringSince: timestamp({ withTimezone: true }),
    version: integer().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('queue_entries_order_idx').on(
      table.levelSlug,
      table.state,
      table.tier,
      table.prioritySince,
      table.lastInvitedAt,
    ),
  ],
);

/** Rodada de distribuição de um projeto. Parâmetros copiados das configurações na abertura. */
export const distributionRounds = pgTable(
  'distribution_rounds',
  {
    id: uuid().primaryKey(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text().$type<'OPEN' | 'SELECTED' | 'EXHAUSTED' | 'CLOSED' | 'CANCELLED'>().notNull(),
    levelSlug: text()
      .notNull()
      .references(() => levels.slug),
    projectType: text().notNull(),
    requiredStacks: text().array().notNull().default([]),
    clientId: uuid()
      .notNull()
      .references(() => users.id),
    params: jsonb().$type<RoundParams>().notNull(),
    openedAt: timestamp({ withTimezone: true }).notNull(),
    closedAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(0),
  },
  (table) => [
    // No máximo uma rodada em andamento por projeto.
    uniqueIndex('distribution_rounds_active_key')
      .on(table.projectId)
      .where(sql`${table.status} in ('OPEN', 'SELECTED')`),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid().primaryKey(),
    roundId: uuid()
      .notNull()
      .references(() => distributionRounds.id, { onDelete: 'cascade' }),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    freelancerId: uuid()
      .notNull()
      .references(() => users.id),
    status: text().$type<InvitationStatus>().notNull(),
    invitedAt: timestamp({ withTimezone: true }).notNull(),
    deadlineAt: timestamp({ withTimezone: true }).notNull(),
    respondedAt: timestamp({ withTimezone: true }),
    proposalAmountCents: integer(),
    proposalDeadlineDays: integer(),
    proposalMessage: text(),
    proposalSubmittedAt: timestamp({ withTimezone: true }),
    proposalUpdatedAt: timestamp({ withTimezone: true }),
    selectionFeedback: jsonb().$type<SelectionFeedbackReason[]>(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    // Um freelancer nunca é convidado duas vezes para o mesmo projeto.
    uniqueIndex('invitations_project_freelancer_key').on(table.projectId, table.freelancerId),
    // Reconciliador de prazos.
    index('invitations_deadline_idx').on(table.status, table.deadlineAt),
    index('invitations_freelancer_idx').on(table.freelancerId, table.status, table.invitedAt),
    index('invitations_round_idx').on(table.roundId),
  ],
);
