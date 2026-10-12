import { integer, jsonb, pgTable, real, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';

/**
 * Estatísticas de desempenho do freelancer, recalculadas pelo job noturno (e sob demanda) a partir
 * de contratos, avaliações, convites e disputas. Read model: a fonte da verdade são os módulos.
 */
export const freelancerStats = pgTable('freelancer_stats', {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  completedContracts: integer().notNull().default(0),
  startedContracts: integer().notNull().default(0),
  ratingCount: integer().notNull().default(0),
  ratingSum: integer().notNull().default(0),
  onTimeContracts: integer().notNull().default(0),
  abandonments: integer().notNull().default(0),
  invitationsAnswered: integer().notNull().default(0),
  invitationsExpired: integer().notNull().default(0),
  score: real().notNull().default(0.5),
  /** Componentes do score (para explicar a posição no painel). */
  components: jsonb()
    .$type<{ rating: number; onTime: number; reliability: number; responsiveness: number }>()
    .notNull(),
  computedAt: timestamp({ withTimezone: true }).notNull(),
});
