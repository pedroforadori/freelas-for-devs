import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { mfaRecoveryCodes, userMfa } from '../../../db/schema/identity.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import type { MfaRecord, MfaRepository } from '../application/ports.js';

export class DrizzleMfaRepository implements MfaRepository {
  constructor(private readonly ctx: DatabaseContext) {}

  async find(userId: string): Promise<MfaRecord | null> {
    const [row] = await this.ctx.executor
      .select()
      .from(userMfa)
      .where(eq(userMfa.userId, userId))
      .limit(1);
    return row
      ? {
          userId: row.userId,
          secretEnc: row.secretEnc,
          enabledAt: row.enabledAt,
          lastUsedStep: row.lastUsedStep,
        }
      : null;
  }

  async savePending(userId: string, secretEnc: string): Promise<void> {
    // Só substitui configurações não confirmadas: nunca sobrescreve um 2FA ativo.
    await this.ctx.executor
      .insert(userMfa)
      .values({ userId, secretEnc })
      .onConflictDoUpdate({
        target: userMfa.userId,
        set: { secretEnc, lastUsedStep: null, updatedAt: sql`now()` },
        setWhere: isNull(userMfa.enabledAt),
      });
  }

  async enable(userId: string, now: Date, step: number): Promise<void> {
    await this.ctx.executor
      .update(userMfa)
      .set({ enabledAt: now, lastUsedStep: step, updatedAt: sql`now()` })
      .where(and(eq(userMfa.userId, userId), isNull(userMfa.enabledAt)));
  }

  async claimStep(userId: string, step: number): Promise<boolean> {
    const updated = await this.ctx.executor
      .update(userMfa)
      .set({ lastUsedStep: step, updatedAt: sql`now()` })
      .where(
        and(
          eq(userMfa.userId, userId),
          or(isNull(userMfa.lastUsedStep), lt(userMfa.lastUsedStep, step)),
        ),
      )
      .returning({ userId: userMfa.userId });
    return updated.length === 1;
  }

  async remove(userId: string): Promise<void> {
    await this.ctx.executor.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    await this.ctx.executor.delete(userMfa).where(eq(userMfa.userId, userId));
  }

  async replaceRecoveryCodes(
    userId: string,
    codes: { id: string; codeHash: string }[],
  ): Promise<void> {
    await this.ctx.executor.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    if (codes.length > 0) {
      await this.ctx.executor
        .insert(mfaRecoveryCodes)
        .values(codes.map((code) => ({ ...code, userId })));
    }
  }

  async consumeRecoveryCode(userId: string, codeHash: string, now: Date): Promise<boolean> {
    const updated = await this.ctx.executor
      .update(mfaRecoveryCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(mfaRecoveryCodes.userId, userId),
          eq(mfaRecoveryCodes.codeHash, codeHash),
          isNull(mfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: mfaRecoveryCodes.id });
    return updated.length === 1;
  }
}
