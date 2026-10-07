import type { RequestMeta } from '../../../shared/application/audit-log.js';
import type { User } from '../domain/user.js';
import type { IdentityDeps } from './deps.js';

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  /** 1 = senha/OAuth; 2 = confirmada com segundo fator. */
  aal: 1 | 2;
}

/** Cria um refresh token (novo ou na mesma família, ao rotacionar) e o access token correspondente. */
export class SessionIssuer {
  constructor(private readonly deps: IdentityDeps) {}

  async start(
    user: User,
    meta: RequestMeta,
    options: { familyId?: string; aal?: 1 | 2 } = {},
  ): Promise<IssuedSession> {
    const { ids, clock, secrets, refreshTokens, accessTokens, settings } = this.deps;
    const sessionId = options.familyId ?? ids.next();
    const aal = options.aal ?? 1;
    const now = clock.now();
    const { token, hash } = secrets.generate();

    await refreshTokens.insert({
      id: ids.next(),
      userId: user.id,
      familyId: sessionId,
      tokenHash: hash,
      expiresAt: new Date(now.getTime() + settings.refreshTokenTtlMs),
      rotatedAt: null,
      revokedAt: null,
      aal,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ip: meta.ip,
    });

    const access = await accessTokens.issue({
      userId: user.id,
      roles: [...user.roles],
      sessionId,
      aal,
    });

    return {
      sessionId,
      accessToken: access.token,
      accessTokenExpiresIn: access.expiresInSeconds,
      refreshToken: token,
      aal,
    };
  }
}
