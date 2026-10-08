import { afterEach, describe, expect, it, vi } from 'vitest';

/** `site` lê o ambiente ao carregar o módulo: cada cenário importa uma cópia nova. */
const load = async (env: Record<string, string>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('./site');
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ctaHref', () => {
  it('sends everyone to the waitlist before launch', async () => {
    const { ctaHref } = await load({ NEXT_PUBLIC_APP_LIVE: 'false' });
    expect(ctaHref('client', 'SITE')).toBe('#lista-de-espera');
    expect(ctaHref('freelancer')).toBe('#lista-de-espera');
  });

  it('sends clients straight to the project draft once the app is live', async () => {
    const { ctaHref } = await load({
      NEXT_PUBLIC_APP_LIVE: 'true',
      NEXT_PUBLIC_APP_URL: 'https://app.exemplo.com',
    });
    expect(ctaHref('client')).toBe('https://app.exemplo.com/novo-projeto');
    expect(ctaHref('client', 'ECOMMERCE')).toBe(
      'https://app.exemplo.com/novo-projeto?tipo=ECOMMERCE',
    );
    expect(ctaHref('freelancer')).toBe('https://app.exemplo.com/cadastro?perfil=freelancer');
  });
});
