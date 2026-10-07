import { AsyncLocalStorage } from 'node:async_hooks';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { UnitOfWork } from '../../application/unit-of-work.js';
import type * as schema from '../../../db/schema/index.js';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | Transaction;

/**
 * Propaga a transação corrente via AsyncLocalStorage: repositórios usam `executor` e
 * participam automaticamente da unidade de trabalho aberta pelo caso de uso.
 */
export class DatabaseContext implements UnitOfWork {
  private readonly storage = new AsyncLocalStorage<Transaction>();

  constructor(private readonly db: Database) {}

  get executor(): DbExecutor {
    return this.storage.getStore() ?? this.db;
  }

  get inTransaction(): boolean {
    return this.storage.getStore() !== undefined;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    // Transações aninhadas reutilizam a externa (sem savepoints implícitos).
    if (this.inTransaction) return work();
    return this.db.transaction((tx) => this.storage.run(tx, work));
  }
}
