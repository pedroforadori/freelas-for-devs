'use client';

import { type Me, type Role } from '@f4d/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { api } from '@/lib/api';

export const meQueryKey = ['session', 'me'] as const;

/** Usuário da sessão, ou null se não houver sessão (401 não é erro aqui). */
export const meQuery = {
  queryKey: meQueryKey,
  queryFn: async (): Promise<Me | null> => {
    const { data, response } = await api.GET('/v1/me');
    if (response.status === 401) return null;
    if (!data) throw new Error(`Falha ao carregar a sessão (${response.status})`);
    return data;
  },
  staleTime: 60_000,
};

export const useSession = () => {
  const query = useQuery(meQuery);
  return { me: query.data ?? null, isLoading: query.isPending };
};

export const hasRole = (me: Me | null, role: Role) => Boolean(me?.roles.includes(role));

/** Após login/cadastro: grava o usuário no cache e segue para o destino. */
export const useCompleteSignIn = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(
    (user: Me, redirectTo = '/painel') => {
      queryClient.setQueryData(meQueryKey, user);
      router.replace(redirectTo);
    },
    [queryClient, router],
  );
};

export const useSignOut = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    await api.POST('/v1/auth/logout', { body: {} });
    queryClient.clear();
    queryClient.setQueryData(meQueryKey, null);
    router.replace('/entrar');
  }, [queryClient, router]);
};

/** Só caminhos internos (mesma regra da API): evita redirecionamento aberto via ?redirectTo=. */
export const safeRedirect = (value: string | null, fallback = '/painel'): string =>
  value && /^\/(?![/\\])/.test(value) ? value : fallback;
