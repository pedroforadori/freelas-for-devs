import type { SettingKey } from '@f4d/contracts';
import { and, eq } from 'drizzle-orm';
import { users } from '../../../db/schema/identity.js';
import { settings } from '../../../db/schema/settings.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import type { SettingsStore, StoredSetting } from '../application/ports.js';

export class DrizzleSettingsStore implements SettingsStore {
  constructor(private readonly ctx: DatabaseContext) {}

  private select() {
    return this.ctx.executor
      .select({
        key: settings.key,
        value: settings.value,
        version: settings.version,
        updatedAt: settings.updatedAt,
        updatedBy: users.displayName,
      })
      .from(settings)
      .innerJoin(users, eq(users.id, settings.updatedBy));
  }

  async list(): Promise<StoredSetting[]> {
    return (await this.select()) as StoredSetting[];
  }

  async find(key: SettingKey): Promise<StoredSetting | null> {
    const [row] = await this.select().where(eq(settings.key, key)).limit(1);
    return (row as StoredSetting | undefined) ?? null;
  }

  async save(input: {
    key: SettingKey;
    value: unknown;
    expectedVersion: number;
    updatedBy: string;
    now: Date;
  }): Promise<boolean> {
    const db = this.ctx.executor;
    const row = { value: input.value, updatedBy: input.updatedBy, updatedAt: input.now };
    if (input.expectedVersion === 0) {
      // Outra pessoa criou a linha antes = conflito de versão (sem abortar a transação).
      const inserted = await db
        .insert(settings)
        .values({ ...row, key: input.key, version: 1 })
        .onConflictDoNothing()
        .returning({ key: settings.key });
      return inserted.length > 0;
    }
    const updated = await db
      .update(settings)
      .set({ ...row, version: input.expectedVersion + 1 })
      .where(and(eq(settings.key, input.key), eq(settings.version, input.expectedVersion)))
      .returning({ key: settings.key });
    return updated.length > 0;
  }
}
