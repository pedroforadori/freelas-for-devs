import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { leads } from '../../../db/schema/leads.js';
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
