import { integer, pgTable, text } from 'drizzle-orm/pg-core';

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
 * Níveis de freelancer. `rank` ordena do inicial (1) ao mais alto. As regras de progressão
 * automática (F9) serão configuráveis por nível.
 */
export const levels = pgTable('levels', {
  slug: text().primaryKey(),
  name: text().notNull(),
  rank: integer().notNull().unique(),
});
