import { NotFoundError } from '../../../shared/kernel/domain-error.js';
import type { IdentityDeps } from './deps.js';

/**
 * API pública da identidade para a moderação: suspender encerra todas as sessões (o access token
 * em uso expira em minutos); reativar devolve o acesso. Participa da transação de quem chama.
 */
export class IdentityFacade {
  constructor(private readonly deps: IdentityDeps) {}

  async suspend(userId: string): Promise<boolean> {
    return this.deps.uow.run(async () => {
      const user = await this.deps.users.findById(userId);
      if (!user) throw new NotFoundError('Usuário', userId);
      const now = this.deps.clock.now();
      const changed = user.suspend(now);
      if (changed) {
        await this.deps.users.save(user);
        await this.deps.refreshTokens.revokeAllForUser(userId, now);
      }
      return changed;
    });
  }

  /** Dados da conta para a exclusão: e-mail atual, se há senha e se é Admin. */
  async describe(userId: string) {
    const user = await this.deps.users.findById(userId);
    if (!user) throw new NotFoundError('Usuário', userId);
    return {
      email: user.email,
      hasPassword: user.passwordHash !== null,
      isAdmin: user.hasRole('ADMIN'),
    };
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.deps.users.findById(userId);
    if (!user?.passwordHash) return false;
    return this.deps.hasher.verify(user.passwordHash, password);
  }

  /**
   * Exclusão da conta (LGPD): anonimiza o usuário, encerra as sessões e apaga 2FA e vínculos de
   * login social. Participa da transação de quem chama.
   */
  async erase(userId: string): Promise<void> {
    await this.deps.uow.run(async () => {
      const user = await this.deps.users.findById(userId);
      if (!user) throw new NotFoundError('Usuário', userId);
      const now = this.deps.clock.now();
      user.anonymize(now);
      await this.deps.users.save(user);
      await this.deps.refreshTokens.revokeAllForUser(userId, now);
      await this.deps.authIdentities.unlinkAll(userId);
      await this.deps.mfa.remove(userId);
    });
  }

  async reinstate(userId: string): Promise<boolean> {
    return this.deps.uow.run(async () => {
      const user = await this.deps.users.findById(userId);
      if (!user) throw new NotFoundError('Usuário', userId);
      const changed = user.reinstate(this.deps.clock.now());
      if (changed) await this.deps.users.save(user);
      return changed;
    });
  }
}
