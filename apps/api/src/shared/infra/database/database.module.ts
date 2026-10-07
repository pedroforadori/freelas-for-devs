import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../../db/schema/index.js';
import { UNIT_OF_WORK } from '../../application/unit-of-work.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { type Database, DatabaseContext } from './database-context.js';

export const PG_POOL = Symbol('PG_POOL');
export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) =>
        new pg.Pool({
          connectionString: env.DATABASE_URL,
          max: env.DATABASE_POOL_MAX,
          application_name: 'f4d-api',
          // Nenhuma query de request deve segurar conexão por mais de 10 s.
          statement_timeout: 10_000,
          idle_in_transaction_session_timeout: 15_000,
        }),
    },
    {
      provide: DATABASE,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool): Database =>
        drizzle({ client: pool, schema, casing: 'snake_case' }),
    },
    {
      provide: DatabaseContext,
      inject: [DATABASE],
      useFactory: (db: Database) => new DatabaseContext(db),
    },
    { provide: UNIT_OF_WORK, useExisting: DatabaseContext },
  ],
  exports: [PG_POOL, DATABASE, DatabaseContext, UNIT_OF_WORK],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
