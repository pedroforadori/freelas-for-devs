import type { Role } from '@f4d/contracts';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { oneTimeTokens, refreshTokens, userRoles, users } from '../../../db/schema/identity.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import { isUniqueViolation } from '../../../shared/infra/database/pg-errors.js';
import {
  appendToOutbox,
  assignEventIds,
} from '../../../shared/infra/outbox/drizzle-outbox.store.js';
import { ConcurrencyError } from '../../../shared/kernel/domain-error.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type {
  OneTimeTokenPurpose,
  OneTimeTokenRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
  UserRepository,
} from '../application/ports.js';
import { EmailAlreadyRegisteredError } from '../domain/errors.js';
import { User } from '../domain/user.js';

export class DrizzleUserRepository implements UserRepository {
  constructor(
    private readonly ctx: DatabaseContext,
    private readonly ids: IdGenerator,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.findOne(eq(users.id, id));
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findOne(eq(users.email, email.trim().toLowerCase()));
  }

  /** Insere ou atualiza com lock otimista; papéis e eventos de outbox na mesma transação. */
  save(user: User): Promise<void> {
    return this.ctx.run(async () => {
      const db = this.ctx.executor;
      const snapshot = user.toSnapshot();
      const row = {
        email: snapshot.email,
        emailVerifiedAt: snapshot.emailVerifiedAt,
        passwordHash: snapshot.passwordHash,
        displayName: snapshot.displayName,
        status: snapshot.status,
        termsAcceptedAt: snapshot.termsAcceptedAt,
      };

      if (snapshot.version === 0) {
        try {
          await db
            .insert(users)
            .values({ ...row, id: snapshot.id, createdAt: snapshot.createdAt, version: 1 });
        } catch (error) {
          if (isUniqueViolation(error, 'users_email_key')) throw new EmailAlreadyRegisteredError();
          throw error;
        }
      } else {
        const updated = await db
          .update(users)
          .set({ ...row, version: snapshot.version + 1, updatedAt: sql`now()` })
          .where(and(eq(users.id, snapshot.id), eq(users.version, snapshot.version)))
          .returning({ id: users.id });
        if (updated.length === 0) throw new ConcurrencyError('User', snapshot.id);
      }

      await db.delete(userRoles).where(eq(userRoles.userId, snapshot.id));
      if (snapshot.roles.length > 0) {
        await db
          .insert(userRoles)
          .values(snapshot.roles.map((role) => ({ userId: snapshot.id, role })));
      }
      await appendToOutbox(db, assignEventIds(user.pullEvents(), this.ids));
      user.markPersisted();
    });
  }

  private async findOne(where: ReturnType<typeof eq>): Promise<User | null> {
    const db = this.ctx.executor;
    const [row] = await db.select().from(users).where(where).limit(1);
    if (!row) return null;
    const roles = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, row.id));
    return User.rehydrate({
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      displayName: row.displayName,
      status: row.status,
      emailVerifiedAt: row.emailVerifiedAt,
      termsAcceptedAt: row.termsAcceptedAt,
      roles: roles.map((r) => r.role as Role).sort(),
      createdAt: row.createdAt,
      version: row.version,
    });
  }
}

export class DrizzleRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly ctx: DatabaseContext) {}

  async insert(record: RefreshTokenRecord & { tokenHash: string }): Promise<void> {
    await this.ctx.executor.insert(refreshTokens).values(record);
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const [row] = await this.ctx.executor
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row ? { ...row, aal: row.aal === 2 ? 2 : 1 } : null;
  }

  async markRotated(id: string, now: Date): Promise<boolean> {
    const updated = await this.ctx.executor
      .update(refreshTokens)
      .set({ rotatedAt: now })
      .where(
        and(
          eq(refreshTokens.id, id),
          isNull(refreshTokens.rotatedAt),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });
    return updated.length === 1;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.ctx.executor
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.ctx.executor
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}

export class DrizzleOneTimeTokenRepository implements OneTimeTokenRepository {
  constructor(private readonly ctx: DatabaseContext) {}

  async insert(record: {
    id: string;
    userId: string;
    purpose: OneTimeTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.ctx.executor.insert(oneTimeTokens).values(record);
  }

  async findValid(
    tokenHash: string,
    purpose: OneTimeTokenPurpose,
    now: Date,
  ): Promise<{ id: string; userId: string } | null> {
    const [row] = await this.ctx.executor
      .select({ id: oneTimeTokens.id, userId: oneTimeTokens.userId })
      .from(oneTimeTokens)
      .where(
        and(
          eq(oneTimeTokens.tokenHash, tokenHash),
          eq(oneTimeTokens.purpose, purpose),
          isNull(oneTimeTokens.consumedAt),
          gt(oneTimeTokens.expiresAt, now),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** UPDATE condicional + RETURNING: dois cliques simultâneos no link não consomem duas vezes. */
  async consume(
    tokenHash: string,
    purpose: OneTimeTokenPurpose,
    now: Date,
  ): Promise<string | null> {
    const [row] = await this.ctx.executor
      .update(oneTimeTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(oneTimeTokens.tokenHash, tokenHash),
          eq(oneTimeTokens.purpose, purpose),
          isNull(oneTimeTokens.consumedAt),
          gt(oneTimeTokens.expiresAt, now),
        ),
      )
      .returning({ userId: oneTimeTokens.userId });
    return row?.userId ?? null;
  }

  async invalidateAll(userId: string, purpose: OneTimeTokenPurpose, now: Date): Promise<void> {
    await this.ctx.executor
      .update(oneTimeTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(oneTimeTokens.userId, userId),
          eq(oneTimeTokens.purpose, purpose),
          isNull(oneTimeTokens.consumedAt),
        ),
      );
  }
}
