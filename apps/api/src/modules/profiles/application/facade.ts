import { ProfileNotFoundError } from '../domain/errors.js';
import { levelChangedEmail } from './emails.js';
import { ProfilesUseCase } from './use-cases.js';

/** API pública do módulo de perfis para a reputação (F9): progressão de nível pelo desempenho. */
export class ProfilesFacade extends ProfilesUseCase {
  /**
   * Sobe o freelancer de `fromLevel` para `toLevel` (registro no histórico, sem autor humano).
   * Idempotente: se o nível já mudou desde o cálculo, não faz nada e devolve false.
   */
  /** Exclusão da conta (LGPD): perfis sem dados pessoais. Participa da transação de quem chama. */
  async erase(userId: string): Promise<void> {
    await this.deps.uow.run(async () => {
      const profile = await this.deps.profiles.find(userId);
      if (profile) {
        profile.erase(this.deps.clock.now());
        await this.deps.profiles.save(profile);
      }
      if (await this.deps.clients.find(userId))
        await this.deps.clients.upsert({ userId, companyName: null });
    });
  }

  async promote(input: {
    userId: string;
    fromLevel: string;
    toLevel: string;
    reason: string;
    promotedBy: string | null;
  }): Promise<boolean> {
    const level = await this.deps.catalog.findLevel(input.toLevel);
    if (!level) return false;
    const promoted = await this.deps.uow.run(async () => {
      const profile = await this.deps.profiles.find(input.userId);
      if (!profile) throw new ProfileNotFoundError();
      if (profile.toSnapshot().levelSlug !== input.fromLevel || profile.status !== 'APPROVED')
        return false;
      const change = profile.reclassify(input.toLevel, this.deps.clock.now());
      await this.deps.profiles.save(profile);
      await this.deps.levelHistory.record({
        id: this.deps.ids.next(),
        userId: input.userId,
        ...change,
        reason: input.reason,
        changedBy: input.promotedBy,
      });
      return true;
    });
    if (promoted)
      await this.notify(input.userId, (to, name) =>
        levelChangedEmail(
          to,
          name,
          level.name,
          this.profileUrl,
          'Parabéns: seu desempenho nos projetos (entregas no prazo e avaliações dos clientes) garantiu a promoção. A partir de agora você recebe convites deste nível.',
        ),
      );
    return promoted;
  }
}
