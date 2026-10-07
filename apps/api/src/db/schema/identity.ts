import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
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
    /** Nível de autenticação da sessão (1 = senha, 2 = com segundo fator); preservado ao rotacionar. */
    aal: smallint().notNull().default(1),
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
    purpose: text().$type<'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'MFA_CHALLENGE'>().notNull(),
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

/**
 * Segundo fator TOTP. O segredo é cifrado (AES-256-GCM) com a chave de campo da aplicação:
 * um dump do banco sozinho não permite gerar códigos.
 */
export const userMfa = pgTable('user_mfa', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretEnc: text().notNull(),
  /** Nulo enquanto a configuração não foi confirmada com um código válido. */
  enabledAt: timestamp({ withTimezone: true }),
  /** Último passo TOTP aceito: impede reutilizar o mesmo código (replay). */
  lastUsedStep: integer(),
  ...timestamps,
});

export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text().notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mfa_recovery_codes_user_idx').on(table.userId),
    uniqueIndex('mfa_recovery_codes_hash_key').on(table.codeHash),
  ],
);

/** Contas externas vinculadas (login social). Um provedor+id externo aponta para um único usuário. */
export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text().$type<'github' | 'google'>().notNull(),
    providerUserId: text().notNull(),
    /** E-mail informado pelo provedor no momento do vínculo (auditoria). */
    email: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_identities_provider_key').on(table.provider, table.providerUserId),
    index('auth_identities_user_idx').on(table.userId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type OneTimeTokenRow = typeof oneTimeTokens.$inferSelect;
