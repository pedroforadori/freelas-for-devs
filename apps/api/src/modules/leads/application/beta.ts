import type { BetaOverview } from '@f4d/contracts';
import type { AuditLogger, RequestMeta } from '../../../shared/application/audit-log.js';
import type { Mailer } from '../../../shared/application/mailer.js';
import type { SettingsReader } from '../../../shared/application/settings-reader.js';
import { simpleEmail } from '../../../shared/application/simple-email.js';
import type { Clock } from '../../../shared/kernel/clock.js';

export interface BetaStore {
  isInvited(email: string): Promise<boolean>;
  invite(emails: readonly string[], invitedBy: string, now: Date): Promise<string[]>;
  overview(): Promise<Omit<BetaOverview, 'signupMode'>>;
  /** Exclusão de conta (LGPD): some da lista de espera e dos convites. */
  forget(email: string): Promise<void>;
}

export interface BetaDeps {
  store: BetaStore;
  settings: SettingsReader;
  mailer: Mailer;
  audit: AuditLogger;
  clock: Clock;
  webAppUrl: string;
}

const normalize = (email: string) => email.trim().toLowerCase();

/** API pública do módulo para a identidade (cadastro) e a privacidade (exclusão). */
export class LeadsFacade {
  constructor(private readonly deps: BetaDeps) {}

  /** Cadastro liberado: modo aberto, ou e-mail convidado no beta fechado. */
  async signupAllowed(email: string): Promise<boolean> {
    if ((await this.deps.settings.get('access.signupMode')) === 'OPEN') return true;
    return this.deps.store.isInvited(normalize(email));
  }

  forget(email: string): Promise<void> {
    return this.deps.store.forget(normalize(email));
  }
}

/** Painel do beta: lista de espera e convites (libera o cadastro e avisa por e-mail). */
export class ManageBeta {
  constructor(private readonly deps: BetaDeps) {}

  async overview(): Promise<BetaOverview> {
    return {
      signupMode: await this.deps.settings.get('access.signupMode'),
      ...(await this.deps.store.overview()),
    };
  }

  async invite(adminId: string, emails: readonly string[], meta: RequestMeta): Promise<number> {
    const unique = [...new Set(emails.map(normalize))];
    const created = await this.deps.store.invite(unique, adminId, this.deps.clock.now());
    for (const email of created) {
      const url = `${this.deps.webAppUrl}/cadastro?email=${encodeURIComponent(email)}`;
      await this.deps.mailer
        .send(
          simpleEmail(
            email,
            'leads.beta-invite',
            'Seu convite para o beta da Freelas 4 Devs',
            [
              'Olá! Você está entre as primeiras pessoas convidadas para usar a Freelas 4 Devs.',
              'Crie sua conta com este e-mail (por senha, GitHub ou Google) para publicar projetos ou receber convites como dev.',
            ],
            { label: 'Criar minha conta', url },
          ),
        )
        .catch(() => undefined);
    }
    await this.deps.audit.record({
      actorId: adminId,
      action: 'admin.beta_invited',
      targetType: 'beta_invite',
      targetId: null,
      metadata: { invited: created.length, requested: unique.length },
      request: meta,
    });
    return created.length;
  }
}
