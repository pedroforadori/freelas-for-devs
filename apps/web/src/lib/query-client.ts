import { ApiError } from '@f4d/api-client';
import { isServer, QueryClient } from '@tanstack/react-query';

/**
 * Estado de servidor (ADR-0007). Erros 4xx são definitivos (não adianta repetir);
 * falhas de rede e 5xx são repetidas até 2 vezes.
 */
const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.problem.status < 500) && failureCount < 2,
      },
      mutations: { retry: false },
    },
  });

let browserQueryClient: QueryClient | undefined;

/** No servidor, um cliente por request; no browser, um singleton (sobrevive a suspense). */
export const getQueryClient = (): QueryClient => {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
};
