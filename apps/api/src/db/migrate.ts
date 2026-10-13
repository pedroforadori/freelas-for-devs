/**
 * Aplica as migrações pendentes. Roda como release job antes do rollout (docs/architecture.md §8),
 * com um usuário de banco diferente do usado pela aplicação.
 */
import '../shared/config/dotenv.js';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Defina MIGRATION_DATABASE_URL ou DATABASE_URL.');

// dist/db/migrate.js e src/db/migrate.ts resolvem para apps/api/src/db/migrations.
const migrationsFolder = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder });
  process.stdout.write('Migrações aplicadas.\n');
} finally {
  await pool.end();
}
