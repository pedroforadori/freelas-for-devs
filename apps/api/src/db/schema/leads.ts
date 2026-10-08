import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Lista de espera da landing. Dados mínimos (LGPD) e prova do consentimento: versão do texto
 * aceito e quando. Um registro por e-mail e perfil (cliente/freelancer).
 */
export const leads = pgTable(
  'leads',
  {
    id: uuid().primaryKey(),
    profile: text().$type<'CLIENT' | 'FREELANCER'>().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    mainStack: text(),
    consentVersion: text().notNull(),
    consentedAt: timestamp({ withTimezone: true }).notNull(),
    utm: jsonb().$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('leads_email_profile_key').on(table.email, table.profile)],
);
