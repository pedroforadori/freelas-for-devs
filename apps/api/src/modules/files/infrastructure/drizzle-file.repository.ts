import { and, eq } from 'drizzle-orm';
import { files } from '../../../db/schema/files.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import {
  appendToOutbox,
  assignEventIds,
} from '../../../shared/infra/outbox/drizzle-outbox.store.js';
import { ConcurrencyError } from '../../../shared/kernel/domain-error.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type { FileRepository } from '../application/ports.js';
import { StoredFile } from '../domain/stored-file.js';

export class DrizzleFileRepository implements FileRepository {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  async find(id: string): Promise<StoredFile | null> {
    const [row] = await this.ctx.executor.select().from(files).where(eq(files.id, id)).limit(1);
    return row ? StoredFile.rehydrate(row) : null;
  }

  save(file: StoredFile): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.executor;
      const { version, ...row } = file.toSnapshot();
      if (version === 0) {
        await db.insert(files).values({ ...row, version: 1 });
      } else {
        const updated = await db
          .update(files)
          .set({
            status: row.status,
            rejectionReason: row.rejectionReason,
            readyAt: row.readyAt,
            version: version + 1,
          })
          .where(and(eq(files.id, row.id), eq(files.version, version)))
          .returning({ id: files.id });
        if (updated.length === 0) throw new ConcurrencyError('StoredFile', row.id);
      }
      await appendToOutbox(db, assignEventIds(file.pullEvents(), this.ids));
      file.markPersisted();
    });
  }
}
