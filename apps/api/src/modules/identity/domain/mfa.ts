import { Role } from '@f4d/contracts';

export const RECOVERY_CODE_COUNT = 10;

/** Papéis para os quais o segundo fator é obrigatório (não pode ser desativado). */
export const MFA_MANDATORY_ROLES: readonly Role[] = [Role.Admin];

export const isMfaMandatoryFor = (roles: readonly Role[]): boolean =>
  roles.some((role) => MFA_MANDATORY_ROLES.includes(role));

/**
 * Um código TOTP só vale uma vez: o passo de tempo precisa ser posterior ao último aceito.
 * Sem isso, um código interceptado poderia ser reutilizado dentro da mesma janela de 30 s.
 */
export const isFreshStep = (step: number, lastUsedStep: number | null): boolean =>
  lastUsedStep === null || step > lastUsedStep;

/** Normaliza o código digitado: ignora espaços, hífens e caixa. */
export const normalizeRecoveryCode = (code: string): string =>
  code.replace(/[\s-]/g, '').toLowerCase();
