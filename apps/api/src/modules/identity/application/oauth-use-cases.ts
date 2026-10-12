import { Role, type SelfAssignableRole } from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import {
  AccountSuspendedError,
  BetaClosedError,
  OAuthEmailNotVerifiedError,
} from '../domain/errors.js';
import { User } from '../domain/user.js';
import type { OAuthProfile } from './ports.js';
import { IdentityUseCase, type LoginOutcome } from './use-cases.js';

/**
 * Login/cadastro com provedor externo (GitHub, Google). Regras de vínculo:
 * 1. Identidade externa já vinculada → entra nessa conta.
 * 2. Senão, conta com o mesmo e-mail → vincula (o provedor precisa ter o e-mail verificado).
 *    Se a conta local não estava verificada, a senha é descartada e sessões são revogadas
 *    (defesa contra quem cadastrou o e-mail da vítima antes dela).
 * 3. Senão, cria a conta com o papel escolhido na tela de cadastro (padrão: cliente).
 * Contas com 2FA continuam exigindo o segundo fator.
 */
export class SignInWithOAuth extends IdentityUseCase {
  async execute(
    profile: OAuthProfile,
    intent: { role?: SelfAssignableRole | undefined },
    meta: RequestMeta,
  ): Promise<LoginOutcome> {
    const { users, authIdentities, refreshTokens, uow, ids, clock, audit } = this.deps;
    if (!profile.emailVerified) throw new OAuthEmailNotVerifiedError();

    const user = await uow.run(async () => {
      const now = clock.now();
      const linkedUserId = await authIdentities.findUserId(
        profile.provider,
        profile.providerUserId,
      );
      if (linkedUserId) return users.findById(linkedUserId);

      const existing = await users.findByEmail(profile.email);
      if (!existing && !(await this.deps.signupGate.allows(profile.email)))
        throw new BetaClosedError();
      const account =
        existing ??
        User.registerViaProvider({
          id: ids.next(),
          email: profile.email,
          displayName: profile.displayName,
          role: intent.role ?? Role.Client,
          provider: profile.provider,
          now,
        });

      if (existing && existing.confirmEmailViaProvider(now)) {
        await refreshTokens.revokeAllForUser(existing.id, now);
      }
      await users.save(account);
      await authIdentities.link({
        id: ids.next(),
        userId: account.id,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
      });
      await audit.record({
        actorId: account.id,
        action: existing ? 'auth.oauth_linked' : 'auth.register',
        targetType: 'user',
        targetId: account.id,
        metadata: { provider: profile.provider, ...(existing ? {} : { role: account.roles[0] }) },
        request: meta,
      });
      return account;
    });

    if (!user?.isActive) throw new AccountSuspendedError();
    return this.signIn(user, meta, { method: 'oauth', provider: profile.provider });
  }
}
