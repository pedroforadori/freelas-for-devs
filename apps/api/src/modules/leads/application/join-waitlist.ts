import type { CreateLeadRequest } from '@f4d/contracts';
import { DomainError } from '../../../shared/kernel/domain-error.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';

export interface LeadRecord {
  id: string;
  profile: 'CLIENT' | 'FREELANCER';
  name: string;
  email: string;
  mainStack: string | null;
  consentVersion: string;
  consentedAt: Date;
  utm: Record<string, string>;
}

export interface LeadRepository {
  /** Insere ou atualiza pelo par (e-mail, perfil). */
  upsert(lead: LeadRecord): Promise<void>;
}

/** Anti-bot plugável (Cloudflare Turnstile em produção). */
export interface CaptchaVerifier {
  verify(token: string | undefined, ip: string | null): Promise<boolean>;
}

export class CaptchaFailedError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Não conseguimos confirmar que você não é um robô. Recarregue a página e tente de novo.');
  }
}

export class JoinWaitlist {
  constructor(
    private readonly deps: {
      leads: LeadRepository;
      captcha: CaptchaVerifier;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  async execute(input: CreateLeadRequest, ip: string | null): Promise<void> {
    // Honeypot preenchido: robô. Responde como sucesso para não ensinar o bot a contornar.
    if (input.website) return;
    if (!(await this.deps.captcha.verify(input.captchaToken, ip))) throw new CaptchaFailedError();

    const utm = Object.fromEntries(
      Object.entries(input.utm ?? {}).filter(([, value]) => Boolean(value)),
    ) as Record<string, string>;
    await this.deps.leads.upsert({
      id: this.deps.ids.next(),
      profile: input.profile,
      name: input.name,
      email: input.email,
      mainStack: input.profile === 'FREELANCER' ? (input.mainStack ?? null) : null,
      consentVersion: input.consentVersion,
      consentedAt: this.deps.clock.now(),
      utm,
    });
  }
}
