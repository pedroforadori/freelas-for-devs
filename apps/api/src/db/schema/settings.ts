import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';

/**
 * Parâmetros de negócio alterados pelo Admin. Só existem linhas para chaves alteradas; as demais
 * valem o padrão do registro em `@f4d/contracts` (SETTINGS). O valor é validado na escrita.
 */
export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  version: integer().notNull(),
  updatedBy: uuid()
    .notNull()
    .references(() => users.id),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
