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
