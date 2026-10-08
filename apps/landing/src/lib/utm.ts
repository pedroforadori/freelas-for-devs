/** Parâmetros de campanha que acompanham o visitante até o cadastro e a lista de espera. */
export const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;
export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>;

const STORAGE_KEY = 'f4d_utm';

export const parseUtm = (search: string): Utm => {
  const params = new URLSearchParams(search);
  const utm: Utm = {};
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`)?.trim().slice(0, 100);
    if (value) utm[key] = value;
  }
  return utm;
};

/** Primeiro toque vence: a campanha que trouxe a pessoa não é sobrescrita por navegação interna. */
export const rememberUtm = (search: string): Utm => {
  const fromUrl = parseUtm(search);
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Utm;
    if (Object.keys(stored).length > 0) return stored;
    if (Object.keys(fromUrl).length > 0)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fromUrl));
  } catch {
    // Armazenamento indisponível (modo privado/bloqueado): segue só com a URL.
  }
  return fromUrl;
};

export const withUtm = (href: string, utm: Utm): string => {
  if (href.startsWith('#') || Object.keys(utm).length === 0) return href;
  const url = new URL(href);
  for (const [key, value] of Object.entries(utm)) url.searchParams.set(`utm_${key}`, value);
  return url.toString();
};
