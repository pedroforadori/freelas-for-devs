import { Role } from '@f4d/contracts';
import { SYSTEM_REQUEST } from '../../../shared/application/audit-log.js';
import { DAY_MS } from '../../../shared/kernel/clock.js';
import { User } from '../domain/user.js';
import { passwordResetEmail } from './emails.js';
import { IdentityUseCase } from './use-cases.js';

export interface ProvisionAdminResult {
  userId: string;
  created: boolean;
  /** Link para definir a senha (válido por 24 h). Exibido uma vez ao operador. */
  passwordSetupUrl: string;
}

/**
 * Cria um Admin (ou promove uma conta existente). Só é acessível por linha de comando —
 * não existe rota HTTP para conceder o papel de Admin.
 */
export class ProvisionAdmin extends IdentityUseCase {
  async execute(input: { email: string; displayName: string }): Promise<ProvisionAdminResult> {
    const { users, uow, ids, clock, audit, settings, mailer } = this.deps;

    const result = await uow.run(async () => {
      const now = clock.now();
      const existing = await users.findByEmail(input.email);
      const user =
        existing ??
        User.provision({
          id: ids.next(),
          email: input.email,
          displayName: input.displayName,
          roles: [Role.Admin],
          now,
        });
      user.grantRole(Role.Admin, now);
      await users.save(user);

      const token = await this.createOneTimeToken(user.id, 'PASSWORD_RESET', DAY_MS);
      await audit.record({
        actorId: null,
        action: 'admin.provisioned',
        targetType: 'user',
        targetId: user.id,
        metadata: { created: !existing, via: 'cli' },
        request: SYSTEM_REQUEST,
      });
      return { user, created: !existing, token };
    });

    const passwordSetupUrl = `${settings.webAppUrl}/redefinir-senha?token=${result.token}`;
    await mailer
      .send(
        passwordResetEmail(result.user.email, result.user.displayName, passwordSetupUrl, 24 * 60),
      )
      .catch(() => undefined);
    return { userId: result.user.id, created: result.created, passwordSetupUrl };
  }
}
