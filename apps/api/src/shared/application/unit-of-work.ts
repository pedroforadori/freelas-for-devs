/**
 * Port de transação usado pelos casos de uso. Tudo executado dentro de `run` — escrita dos
 * agregados e dos eventos no outbox — é confirmado ou desfeito junto.
 */
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
