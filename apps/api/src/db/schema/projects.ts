import type {
  ClarificationAnswer,
  ClarificationQuestion,
  DesiredDeadline,
  Estimate,
  ProjectStatus,
  ProjectType,
  Scope,
} from '@f4d/contracts';
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
import { files } from './files.js';
import { users } from './identity.js';

export interface ClarificationRecord {
  questions: ClarificationQuestion[];
  answers: ClarificationAnswer[] | null;
  askedAt: string;
  answeredAt: string | null;
}

export const projects = pgTable(
  'projects',
  {
    id: uuid().primaryKey(),
    clientId: uuid()
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    type: text().$type<ProjectType>().notNull(),
    description: text().notNull(),
    references: jsonb().$type<string[]>().notNull().default([]),
    desiredDeadline: text().$type<DesiredDeadline>(),
    status: text().$type<ProjectStatus>().notNull(),
    /** 1 na publicação; 2 depois das respostas às perguntas. Torna os jobs de estimativa idempotentes. */
    estimationRound: integer().notNull().default(1),
    clarification: jsonb().$type<ClarificationRecord>(),
    estimate: jsonb().$type<Estimate>(),
    estimateFailed: boolean().notNull().default(false),
    /** Versão atual do escopo (cópia da última linha de scope_versions, para leitura e métricas). */
    scope: jsonb().$type<Scope>(),
    scopeVersion: integer().notNull().default(0),
    scopingStartedAt: timestamp({ withTimezone: true }),
    scopeApprovedAt: timestamp({ withTimezone: true }),
    scopeApprovedBy: uuid().references(() => users.id),
    rejectionReason: text(),
    rejectedAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
    cancelledAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('projects_client_idx').on(table.clientId, table.createdAt, table.id),
    // Fila do Admin por status, mais antigos primeiro.
    index('projects_status_idx').on(table.status, table.createdAt, table.id),
  ],
);

export const projectAttachments = pgTable(
  'project_attachments',
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    position: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.fileId] })],
);

/** Cada chamada ao estimador: custo (tokens), versão do prompt e resultado, para auditoria. */
export const aiEstimationRuns = pgTable(
  'ai_estimation_runs',
  {
    id: uuid().primaryKey(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    round: integer().notNull(),
    outcome: text().$type<'ESTIMATE' | 'CLARIFY' | 'ERROR'>().notNull(),
    model: text().notNull(),
    promptVersion: text().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    durationMs: integer().notNull(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ai_estimation_runs_project_idx').on(table.projectId, table.createdAt)],
);

/** Histórico imutável do escopo: cada "salvar" do especialista é uma versão nova. */
export const scopeVersions = pgTable(
  'scope_versions',
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    scope: jsonb().$type<Scope>().notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.version] })],
);
