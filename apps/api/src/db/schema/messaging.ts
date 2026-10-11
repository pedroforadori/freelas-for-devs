import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { contracts } from './contracts.js';
import { users } from './identity.js';
import { projects } from './projects.js';

/** Conversa de escopo (uma por projeto) ou de contrato (uma por contrato). */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid().primaryKey(),
    kind: text().$type<'SCOPING' | 'CONTRACT'>().notNull(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    contractId: uuid().references(() => contracts.id, { onDelete: 'cascade' }),
    clientId: uuid()
      .notNull()
      .references(() => users.id),
    /** Só nas conversas de contrato; nas de escopo, qualquer especialista (Admin) participa. */
    freelancerId: uuid().references(() => users.id),
    lastMessageAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('conversations_scoping_key')
      .on(table.projectId)
      .where(sql`${table.kind} = 'SCOPING'`),
    uniqueIndex('conversations_contract_key').on(table.contractId),
    index('conversations_client_idx').on(table.clientId, table.lastMessageAt),
    index('conversations_freelancer_idx').on(table.freelancerId, table.lastMessageAt),
  ],
);

/** Até onde cada participante leu (mensagens não lidas = depois deste instante). */
export const conversationReads = pgTable(
  'conversation_reads',
  {
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.userId] })],
);

/**
 * Mensagens: o corpo é gravado já mascarado; o original só existe cifrado (AES-GCM) quando havia
 * contato, para a moderação — nunca é transmitido nem exibido ao outro participante.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid().primaryKey(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid()
      .notNull()
      .references(() => users.id),
    senderRole: text().$type<'CLIENT' | 'FREELANCER' | 'SPECIALIST'>().notNull(),
    body: text().notNull(),
    masked: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    index('messages_conversation_idx').on(table.conversationId, table.createdAt, table.id),
  ],
);

/** Tentativa de passar contato (chat ou proposta), com o original cifrado para o Admin. */
export const contactViolations = pgTable(
  'contact_violations',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text().$type<'CHAT' | 'PROPOSAL'>().notNull(),
    referenceId: uuid().notNull(),
    projectId: uuid().references(() => projects.id, { onDelete: 'set null' }),
    kinds: text().array().notNull(),
    maskedText: text().notNull(),
    originalEncrypted: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    index('contact_violations_user_idx').on(table.userId, table.createdAt),
    index('contact_violations_recent_idx').on(table.createdAt),
  ],
);

/** Advertências e suspensões (histórico da moderação). */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text().$type<'WARNING' | 'SUSPENSION' | 'REINSTATEMENT'>().notNull(),
    reason: text().notNull(),
    /** Nulo = automático (política de reincidência). */
    actorId: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [index('moderation_actions_user_idx').on(table.userId, table.createdAt)],
);
