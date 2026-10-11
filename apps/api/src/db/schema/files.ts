import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity.js';

export const files = pgTable(
  'files',
  {
    id: uuid().primaryKey(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text().$type<'PORTFOLIO_IMAGE' | 'PROJECT_ATTACHMENT' | 'DELIVERY_FILE'>().notNull(),
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

/**
 * Acesso de leitura concedido a outra pessoa (ex.: anexos do projeto para o freelancer convidado,
 * arquivos da entrega para o cliente). Sem concessão, só o dono e o Admin leem o arquivo.
 */
export const fileAccessGrants = pgTable(
  'file_access_grants',
  {
    fileId: uuid()
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.fileId, table.userId] })],
);
