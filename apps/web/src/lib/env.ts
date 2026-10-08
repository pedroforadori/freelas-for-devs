import { z } from 'zod';

/**
 * Variáveis públicas (vão para o bundle do browser): nunca colocar segredos aqui.
 * Referenciadas literalmente para que o Next as substitua no build.
 */
export const publicEnv = z
  .object({ NEXT_PUBLIC_API_URL: z.url(), NEXT_PUBLIC_SITE_URL: z.url() })
  .parse({
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333',
    // Site público (apps/landing): termos e política de privacidade moram lá.
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001',
  });

export const legalUrls = {
  terms: `${publicEnv.NEXT_PUBLIC_SITE_URL}/termos`,
  privacy: `${publicEnv.NEXT_PUBLIC_SITE_URL}/privacidade`,
} as const;
