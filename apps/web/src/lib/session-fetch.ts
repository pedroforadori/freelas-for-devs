/**
 * fetch com renovação transparente de sessão (ADR-0006):
 * - 401 numa rota comum → tenta POST /v1/auth/refresh uma vez e repete a requisição.
 * - Várias requisições com 401 ao mesmo tempo compartilham uma única renovação.
 * - Refresh 409 = outra aba renovou primeiro: o cookie novo já está no browser, só repetir.
 * - Refresh falhou → sessão expirada (o app volta para o login).
 */
const AUTH_ROUTES = /\/v1\/auth\/(login|register|refresh|logout|mfa\/verify|password\/)/;

export interface SessionFetchHooks {
  refresh: () => Promise<Response>;
  onSessionExpired: () => void;
}

export const createSessionFetch = (
  baseFetch: typeof fetch,
  hooks: SessionFetchHooks,
): typeof fetch => {
  let inFlight: Promise<boolean> | null = null;

  const refreshOnce = (): Promise<boolean> => {
    inFlight ??= hooks
      .refresh()
      .then((response) => response.ok || response.status === 409)
      .catch(() => false)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return async (input, init) => {
    const request = new Request(input, init);
    // Corpo de Request só pode ser lido uma vez: guarda uma cópia para a repetição.
    const retry = request.clone();
    const response = await baseFetch(request);
    if (response.status !== 401 || AUTH_ROUTES.test(request.url)) return response;

    if (await refreshOnce()) return baseFetch(retry);
    hooks.onSessionExpired();
    return response;
  };
};
