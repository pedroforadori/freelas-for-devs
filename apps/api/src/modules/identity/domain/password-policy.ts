import { err, ok, type Result } from '../../../shared/kernel/result.js';
import { WeakPasswordError } from './errors.js';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/**
 * Senhas mais comuns em vazamentos (amostra). Complementar, no futuro, com a API k-anonymity
 * do HaveIBeenPwned (docs/architecture.md §7).
 */
const COMMON = new Set([
  '1234567890',
  '12345678910',
  '0123456789',
  'qwertyuiop',
  'senha12345',
  'senha123456',
  'password123',
  'password1234',
  'iloveyou123',
  'abcdefghij',
  'brasil1234',
  'brasil12345',
  'mudar12345',
  'admin12345',
  'qwerty1234',
  '1q2w3e4r5t',
  'aaaaaaaaaa',
]);

/**
 * Política NIST 800-63B: comprimento mínimo, sem regras de composição arbitrárias,
 * bloqueio de senhas comuns e de senhas derivadas dos dados do próprio usuário.
 */
export const checkPassword = (
  password: string,
  context: { email: string; displayName?: string },
): Result<void, WeakPasswordError> => {
  if (password.length < PASSWORD_MIN) {
    return err(new WeakPasswordError(`A senha precisa ter ao menos ${PASSWORD_MIN} caracteres.`));
  }
  if (password.length > PASSWORD_MAX) {
    return err(new WeakPasswordError(`A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`));
  }
  const normalized = password.toLowerCase();
  if (COMMON.has(normalized) || new Set(normalized).size <= 2) {
    return err(new WeakPasswordError('Esta senha é muito comum. Escolha outra.'));
  }
  // Compara só letras e números: "Maria Souza 2026!" contém "mariasouza".
  const alnum = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const compact = alnum(password);
  const personal = [context.email.split('@')[0] ?? '', context.displayName ?? '']
    .map(alnum)
    .filter((value) => value.length >= 4);
  if (personal.some((value) => compact.includes(value))) {
    return err(new WeakPasswordError('A senha não pode conter seu nome ou e-mail.'));
  }
  return ok(undefined);
};
