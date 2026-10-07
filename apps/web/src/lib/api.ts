import { createApiClient, CSRF_COOKIE, CSRF_HEADER, readCookie } from '@f4d/api-client';
import type { OAuthProviderName, SelfAssignableRole } from '@f4d/contracts';
import { publicEnv } from './env';
import { createSessionFetch } from './session-fetch';

const baseUrl = publicEnv.NEXT_PUBLIC_API_URL;

let sessionExpiredHandler: () => void = () => undefined;

/** Registrado pelos Providers: limpa a sessão em cache quando a renovação falha. */
export const onSessionExpired = (handler: () => void) => {
  sessionExpiredHandler = handler;
};

const refreshSession = () =>
  fetch(`${baseUrl}/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', [CSRF_HEADER]: readCookie(CSRF_COOKIE) ?? '' },
    body: '{}',
  });

/** Cliente tipado da API. Sessão via cookie httpOnly; CSRF via double-submit; renovação automática. */
export const api = createApiClient({
  baseUrl,
  getCsrfToken: () => readCookie(CSRF_COOKIE),
  fetch: createSessionFetch((request) => fetch(request), {
    refresh: refreshSession,
    onSessionExpired: () => sessionExpiredHandler(),
  }),
});

/** Garante o cookie CSRF antes da primeira requisição mutável (login, cadastro...). */
export const ensureCsrf = async (): Promise<void> => {
  if (readCookie(CSRF_COOKIE)) return;
  await fetch(`${baseUrl}/v1/auth/csrf`, { credentials: 'include' });
};

/** Login social é navegação de página inteira (a API redireciona para o provedor). */
export const oauthStartUrl = (
  provider: OAuthProviderName,
  options: { role?: SelfAssignableRole; redirectTo?: string } = {},
): string => {
  const url = new URL(`${baseUrl}/v1/auth/oauth/${provider}`);
  if (options.role) url.searchParams.set('role', options.role);
  if (options.redirectTo) url.searchParams.set('redirectTo', options.redirectTo);
  return url.toString();
};
