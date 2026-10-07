import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey(),
    /** Sempre normalizado em minúsculas pela camada de domínio. */
    email: text().notNull(),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    /** Nulo para contas criadas só via OAuth. */
    passwordHash: text(),
    displayName: text().notNull(),
    status: text().$type<'ACTIVE' | 'SUSPENDED'>().notNull().default('ACTIVE'),
    termsAcceptedAt: timestamp({ withTimezone: true }).notNull(),
    version: integer().notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    grantedBy: uuid().references(() => users.id),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

/**
 * Refresh tokens opacos e rotativos. Só o hash SHA-256 é guardado. Tokens de uma mesma
 * sessão compartilham `familyId`: reuso de um token já rotacionado revoga a família inteira.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid().notNull(),
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    rotatedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    userAgent: text(),
    ip: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_key').on(table.tokenHash),
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_user_active_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

/** Tokens de uso único enviados por e-mail (verificação, redefinição de senha). */
export const oneTimeTokens = pgTable(
  'one_time_tokens',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text().$type<'EMAIL_VERIFICATION' | 'PASSWORD_RESET'>().notNull(),
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('one_time_tokens_hash_key').on(table.tokenHash),
    index('one_time_tokens_user_purpose_idx').on(table.userId, table.purpose),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type OneTimeTokenRow = typeof oneTimeTokens.$inferSelect;
