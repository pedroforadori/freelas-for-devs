import { v7 } from 'uuid';
import type { IdGenerator } from '../../kernel/domain-event.js';

/** UUIDv7: ordenável no tempo (bom para índices B-tree) e não sequencial (evita enumeração/IDOR). */
export class UuidV7Generator implements IdGenerator {
  next(): string {
    return v7();
  }
}

export const ID_GENERATOR = Symbol('ID_GENERATOR');
