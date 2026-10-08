import { describe, expect, it } from 'vitest';
import { parseUtm, withUtm } from './utm';

describe('utm', () => {
  it('reads only known utm parameters, trimmed and capped', () => {
    expect(
      parseUtm('?utm_source=instagram&utm_campaign=%20lancamento%20&foo=bar&utm_medium='),
    ).toEqual({
      source: 'instagram',
      campaign: 'lancamento',
    });
  });

  it('appends utm to app links and leaves anchors alone', () => {
    expect(withUtm('https://app.test/cadastro?perfil=freelancer', { source: 'ig' })).toBe(
      'https://app.test/cadastro?perfil=freelancer&utm_source=ig',
    );
    expect(withUtm('#lista-de-espera', { source: 'ig' })).toBe('#lista-de-espera');
  });
});
