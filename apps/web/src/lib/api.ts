import { createApiClient, CSRF_COOKIE, readCookie } from '@f4d/api-client';
import { publicEnv } from './env';

/** Cliente tipado da API. Sessão via cookie httpOnly; CSRF via double-submit. */
export const api = createApiClient({
  baseUrl: publicEnv.NEXT_PUBLIC_API_URL,
  getCsrfToken: () => readCookie(CSRF_COOKIE),
});
