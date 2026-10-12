import { and, eq } from 'drizzle-orm';
import { authIdentities } from '../../../db/schema/identity.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import type { AuthIdentityRepository, OAuthProviderName } from '../application/ports.js';

export class DrizzleAuthIdentityRepository implements AuthIdentityRepository {
  constructor(private readonly ctx: DatabaseContext) {}

  async findUserId(provider: OAuthProviderName, providerUserId: string): Promise<string | null> {
    const [row] = await this.ctx.executor
      .select({ userId: authIdentities.userId })
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, provider),
          eq(authIdentities.providerUserId, providerUserId),
        ),
      )
      .limit(1);
    return row?.userId ?? null;
  }

  async link(input: {
    id: string;
    userId: string;
    provider: OAuthProviderName;
    providerUserId: string;
    email: string;
  }): Promise<void> {
    await this.ctx.executor.insert(authIdentities).values(input).onConflictDoNothing();
  }

  async unlinkAll(userId: string): Promise<void> {
    await this.ctx.executor.delete(authIdentities).where(eq(authIdentities.userId, userId));
  }
}
