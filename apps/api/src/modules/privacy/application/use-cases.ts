import type { DataExport, DeletionCheck } from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { DAY_MS } from '../../../shared/kernel/clock.js';
import { DomainError } from '../../../shared/kernel/domain-error.js';
import type { PrivacyDeps } from './ports.js';

export class AccountDeletionBlockedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(message: string) {
    super(message);
  }
}

export class WrongPasswordError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('Senha incorreta.');
  }
}

/** Acesso e portabilidade (LGPD art. 18, II e V): tudo o que a plataforma guarda sobre a pessoa. */
export class ExportMyData {
  constructor(private readonly deps: PrivacyDeps) {}

  async execute(userId: string, meta: RequestMeta): Promise<DataExport> {
    const { email } = await this.deps.account.describe(userId);
    const data = await this.deps.data.export(userId, email);
    await this.deps.audit.record({
      actorId: userId,
      action: 'privacy.data_exported',
      targetType: 'user',
      targetId: userId,
      request: meta,
    });
    return {
      format: 'freelas4devs-export/v1',
      generatedAt: this.deps.clock.now().toISOString(),
      ...data,
    };
  }
}

/**
 * Eliminação (LGPD art. 18, VI): anonimiza a conta, apaga perfis, vínculos sociais, 2FA e a
 * lista de espera. Ficam, sem identificar a pessoa, os registros que a lei ou a outra parte
 * precisam: contratos, pagamentos e razão (obrigação fiscal), mensagens recebidas pela outra
 * parte e a auditoria. Bloqueada enquanto houver contrato ou projeto em andamento.
 */
export class DeleteMyAccount {
  constructor(private readonly deps: PrivacyDeps) {}

  async check(userId: string): Promise<DeletionCheck> {
    const account = await this.deps.account.describe(userId);
    const open = await this.deps.data.openObligations(userId);
    const blockers: DeletionCheck['blockers'] = [];
    if (account.isAdmin)
      blockers.push({
        kind: 'ADMIN',
        count: 1,
        message: 'Contas de Admin são removidas pelo responsável técnico, não pelo próprio painel.',
      });
    if (open.contracts > 0)
      blockers.push({
        kind: 'OPEN_CONTRACTS',
        count: open.contracts,
        message:
          'Há contratos em andamento (pagamento, entregas, disputa ou repasse). Conclua-os antes.',
      });
    if (open.projects > 0)
      blockers.push({
        kind: 'OPEN_PROJECTS',
        count: open.projects,
        message: 'Há projetos publicados em andamento. Cancele-os ou conclua-os antes.',
      });
    return { canDelete: blockers.length === 0, blockers, hasPassword: account.hasPassword };
  }

  async execute(userId: string, password: string | undefined, meta: RequestMeta): Promise<void> {
    const check = await this.check(userId);
    if (!check.canDelete) throw new AccountDeletionBlockedError(check.blockers[0]!.message);
    if (
      check.hasPassword &&
      !(password && (await this.deps.account.verifyPassword(userId, password)))
    )
      throw new WrongPasswordError();
    const { email } = await this.deps.account.describe(userId);
    await this.deps.uow.run(async () => {
      await this.deps.profiles.erase(userId);
      await this.deps.leads.forget(email);
      await this.deps.account.erase(userId);
      await this.deps.audit.record({
        actorId: userId,
        action: 'privacy.account_deleted',
        targetType: 'user',
        targetId: userId,
        request: meta,
      });
    });
  }
}

/** Job diário: aplica os prazos de retenção (minimização de dados). */
export class PurgeExpiredData {
  constructor(private readonly deps: PrivacyDeps) {}

  async execute(): Promise<Record<string, number>> {
    const now = this.deps.clock.now().getTime();
    const ago = (days: number) => new Date(now - days * DAY_MS);
    const { retention, settings } = this.deps;
    return {
      violationOriginals: await retention.purgeViolationOriginals(
        ago(await settings.get('privacy.violationOriginalRetentionDays')),
      ),
      oneTimeTokens: await retention.purgeOneTimeTokens(ago(30)),
      refreshTokens: await retention.purgeRefreshTokens(ago(30)),
      outbox: await retention.purgePublishedOutbox(ago(30)),
      webhookEvents: await retention.purgeWebhookEvents(ago(90)),
    };
  }
}
