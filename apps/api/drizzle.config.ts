import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://f4d:f4d@localhost:5432/f4d' },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
