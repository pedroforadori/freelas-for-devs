import { z } from 'zod';

/**
 * Variáveis públicas (vão para o bundle do browser): nunca colocar segredos aqui.
 * Referenciadas literalmente para que o Next as substitua no build.
 */
export const publicEnv = z
  .object({ NEXT_PUBLIC_API_URL: z.url() })
  .parse({ NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333' });
