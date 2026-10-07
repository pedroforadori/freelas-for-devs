export interface RefreshTokenState {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

export type RotationDecision =
  | { kind: 'rotate' }
  | { kind: 'reuse-detected' }
  /** Outra aba acabou de rotacionar: recusa sem revogar a sessão; o cliente tenta de novo. */
  | { kind: 'superseded' }
  | { kind: 'expired' }
  | { kind: 'revoked' };

/**
 * Regra de rotação de refresh tokens (OAuth 2.0 Security BCP §4.14):
 * cada token vale uma única vez. Apresentar um token já rotacionado indica roubo —
 * a família inteira (a sessão) é revogada, derrubando também o atacante.
 *
 * `graceMs` tolera a corrida legítima de duas abas renovando ao mesmo tempo.
 */
export const decideRotation = (
  token: RefreshTokenState,
  now: Date,
  graceMs = 10_000,
): RotationDecision => {
  if (token.revokedAt) return { kind: 'revoked' };
  if (token.rotatedAt) {
    return now.getTime() - token.rotatedAt.getTime() <= graceMs
      ? { kind: 'superseded' }
      : { kind: 'reuse-detected' };
  }
  if (token.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };
  return { kind: 'rotate' };
};
