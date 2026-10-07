import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Trilha de auditoria append-only de ações sensíveis (docs/architecture.md §7).
 * A aplicação só insere; o usuário de banco da aplicação não deve ter UPDATE/DELETE aqui.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey(),
    /** Nulo para ações do sistema (jobs) ou anônimas (login falho). */
    actorId: uuid(),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: text(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: text(),
    userAgent: text(),
    requestId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_actor_idx').on(table.actorId, table.createdAt),
    index('audit_log_target_idx').on(table.targetType, table.targetId),
    index('audit_log_action_idx').on(table.action, table.createdAt),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
