import { describe, expect, it } from 'vitest';
import { checkPassword } from './password-policy.js';

const context = { email: 'maria.souza@exemplo.com', displayName: 'Maria Souza' };

describe('checkPassword', () => {
  it('accepts a long passphrase', () => {
    expect(checkPassword('cavalo correto bateria grampo', context).ok).toBe(true);
  });

  it.each([
    ['curta', 'ao menos 10'],
    ['senha12345', 'muito comum'],
    ['aaaaaaaaaaaa', 'muito comum'],
    ['minhasenhamaria.souza', 'nome ou e-mail'],
    ['Maria Souza 2026!', 'nome ou e-mail'],
  ])('rejects %s', (password, message) => {
    const result = checkPassword(password, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain(message);
  });
});
