import { Logger } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { users } from '../../../db/schema/identity.js';
import { betaInvites, leads } from '../../../db/schema/leads.js';
import type { BetaStore } from '../application/beta.js';
import type { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import type { CaptchaVerifier, LeadRecord, LeadRepository } from '../application/join-waitlist.js';

export class DrizzleLeadRepository implements LeadRepository {
  constructor(private readonly ctx: DatabaseContext) {}

  async upsert(lead: LeadRecord): Promise<void> {
    await this.ctx.executor
      .insert(leads)
      .values(lead)
      .onConflictDoUpdate({
        target: [leads.email, leads.profile],
        set: {
          name: lead.name,
          mainStack: lead.mainStack,
          consentVersion: lead.consentVersion,
          consentedAt: lead.consentedAt,
          updatedAt: sql`now()`,
        },
      });
  }
}

/** https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ */
export class TurnstileVerifier implements CaptchaVerifier {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(token: string | undefined, ip: string | null): Promise<boolean> {
    if (!token) return false;
    const body = new URLSearchParams({
      secret: this.secretKey,
      response: token,
      ...(ip ? { remoteip: ip } : {}),
    });
    const response = await this.fetchImpl(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  }
}

/** Desenvolvimento: sem captcha (o schema de env exige Turnstile em produção). */
export class NoCaptcha implements CaptchaVerifier {
  private warned = false;
  verify(): Promise<boolean> {
    if (!this.warned) {
      new Logger('Captcha').warn(
        'TURNSTILE_SECRET_KEY ausente: formulários públicos sem anti-bot.',
      );
      this.warned = true;
    }
    return Promise.resolve(true);
  }
}

export class DrizzleBetaStore implements BetaStore {
  constructor(private readonly ctx: DatabaseContext) {}

  async isInvited(email: string): Promise<boolean> {
    const [row] = await this.ctx.executor
      .select({ email: betaInvites.email })
      .from(betaInvites)
      .where(eq(betaInvites.email, email))
      .limit(1);
    return Boolean(row);
  }

  async invite(emails: readonly string[], invitedBy: string, now: Date): Promise<string[]> {
    if (emails.length === 0) return [];
    const rows = await this.ctx.executor
      .insert(betaInvites)
      .values(emails.map((email) => ({ email, invitedBy, invitedAt: now })))
      .onConflictDoNothing()
      .returning({ email: betaInvites.email });
    return rows.map((row) => row.email);
  }

  async overview() {
    const db = this.ctx.executor;
    const [waitlist, invites, registered] = await Promise.all([
      db.select().from(leads).orderBy(asc(leads.createdAt)),
      db.select().from(betaInvites),
      db.select({ email: users.email }).from(users),
    ]);
    const accounts = new Set(registered.map((row) => row.email));
    const invitedAt = new Map(invites.map((row) => [row.email, row.invitedAt]));
    const byEmail = new Map<string, (typeof waitlist)[number][]>();
    for (const lead of waitlist)
      byEmail.set(lead.email, [...(byEmail.get(lead.email) ?? []), lead]);
    return {
      waitlist: [...byEmail.entries()].map(([email, entries]) => ({
        email,
        name: entries[0]!.name,
        profiles: entries.map((entry) => entry.profile),
        mainStack: entries.find((entry) => entry.mainStack)?.mainStack ?? null,
        joinedAt: entries[0]!.createdAt.toISOString(),
        invitedAt: invitedAt.get(email)?.toISOString() ?? null,
        registered: accounts.has(email),
      })),
      directInvites: invites
        .filter((invite) => !byEmail.has(invite.email))
        .map((invite) => ({
          email: invite.email,
          invitedAt: invite.invitedAt.toISOString(),
          registered: accounts.has(invite.email),
        })),
    };
  }

  async forget(email: string): Promise<void> {
    await this.ctx.executor.delete(leads).where(inArray(leads.email, [email]));
    await this.ctx.executor.delete(betaInvites).where(eq(betaInvites.email, email));
  }
}
