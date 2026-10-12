import type { PromotionRule } from '@f4d/contracts';
import { integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

/** Catálogo de stacks (seed em migração; o Admin poderá editar no futuro). */
export const stacks = pgTable('stacks', {
  slug: text().primaryKey(),
  name: text().notNull(),
  category: text()
    .$type<
      'frontend' | 'backend' | 'mobile' | 'cms' | 'ecommerce' | 'database' | 'devops' | 'design'
    >()
    .notNull(),
});

/**
 * Níveis de freelancer. `rank` ordena do inicial (1) ao mais alto. `promotion` é a regra para
 * subir deste nível ao próximo (F9); nula no mais alto ou com a progressão desligada.
 */
export const levels = pgTable('levels', {
  slug: text().primaryKey(),
  name: text().notNull(),
  rank: integer().notNull().unique(),
  promotion: jsonb().$type<PromotionRule>(),
});
