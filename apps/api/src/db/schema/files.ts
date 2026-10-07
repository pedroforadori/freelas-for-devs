import { bigint, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';

export const files = pgTable(
  'files',
  {
    id: uuid().primaryKey(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text().$type<'PORTFOLIO_IMAGE' | 'PROJECT_ATTACHMENT'>().notNull(),
    /** Nome saneado, só para exibição/download; a chave no storage é gerada pelo servidor. */
    fileName: text().notNull(),
    contentType: text().notNull(),
    size: bigint({ mode: 'number' }).notNull(),
    status: text().$type<'PENDING_UPLOAD' | 'SCANNING' | 'READY' | 'REJECTED'>().notNull(),
    rejectionReason: text(),
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('files_owner_idx').on(table.ownerId, table.createdAt),
    // Limpeza de uploads abandonados (job periódico).
    index('files_status_idx').on(table.status, table.createdAt),
  ],
);
