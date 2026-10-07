import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { levels, stacks } from './catalog.js';
import { users } from './identity.js';

export const freelancerProfiles = pgTable(
  'freelancer_profiles',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    headline: text().notNull().default(''),
    bio: text().notNull().default(''),
    projectTypes: text().array().notNull().default([]),
    links: jsonb()
      .$type<{ github?: string; linkedin?: string; website?: string }>()
      .notNull()
      .default({}),
    /** Fora de disponibilidade, o freelancer não recebe convites da fila. */
    available: boolean().notNull().default(true),
    status: text()
      .$type<'DRAFT' | 'PENDING_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED'>()
      .notNull()
      .default('DRAFT'),
    levelSlug: text().references(() => levels.slug),
    reviewNote: text(),
    submittedAt: timestamp({ withTimezone: true }),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewedBy: uuid().references(() => users.id),
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('freelancer_profiles_review_queue_idx').on(table.status, table.submittedAt, table.userId),
  ],
);

export const freelancerStacks = pgTable(
  'freelancer_stacks',
  {
    userId: uuid()
      .notNull()
      .references(() => freelancerProfiles.userId, { onDelete: 'cascade' }),
    stackSlug: text()
      .notNull()
      .references(() => stacks.slug),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.stackSlug] }),
    // Busca de freelancers compatíveis por stack (fila de distribuição, F5).
    index('freelancer_stacks_stack_idx').on(table.stackSlug),
  ],
);

export const portfolioItems = pgTable(
  'portfolio_items',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => freelancerProfiles.userId, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text().notNull(),
    url: text(),
    stacks: text().array().notNull().default([]),
    position: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('portfolio_items_user_idx').on(table.userId, table.position)],
);

/** Histórico de níveis: toda mudança (aprovação, reclassificação manual, progressão) com motivo. */
export const levelChanges = pgTable(
  'level_changes',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromLevel: text().references(() => levels.slug),
    toLevel: text()
      .notNull()
      .references(() => levels.slug),
    reason: text().notNull(),
    changedBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('level_changes_user_idx').on(table.userId, table.createdAt)],
);

export const clientProfiles = pgTable('client_profiles', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  companyName: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
