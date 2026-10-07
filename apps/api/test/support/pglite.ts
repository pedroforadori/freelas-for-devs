import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../src/db/schema/index.js';
import type { Database } from '../../src/shared/infra/database/database-context.js';

const migrationsFolder = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

export interface TestDatabase {
  db: Database;
  /** Limpa todas as tabelas da aplicação entre testes. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Postgres real em processo (PGlite/WASM), com as migrações aplicadas: testa repositórios e SQL
 * sem Docker. Conexão única — testes de concorrência real usam Testcontainers (test/integration).
 */
export const createTestDatabase = async (): Promise<TestDatabase> => {
  const client = new PGlite();
  const pgliteDb = drizzle({ client, schema, casing: 'snake_case' });
  await migrate(pgliteDb, { migrationsFolder });

  // Mesmo query builder do node-postgres; só os tipos do resultado bruto diferem.
  const db = pgliteDb as unknown as Database;

  return {
    db,
    reset: async () => {
      const { rows } = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'`,
      );
      if (rows.length === 0) return;
      await client.exec(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
    },
    close: () => client.close(),
  };
};
