'use client';

import { unwrap } from '@f4d/api-client';
import type { FreelancerProfile } from '@f4d/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '@/lib/api';

export const freelancerProfileKey = ['profile', 'freelancer'] as const;

export const useFreelancerProfile = () =>
  useQuery({
    queryKey: freelancerProfileKey,
    queryFn: () => unwrap(api.GET('/v1/me/freelancer-profile')),
  });

/** O catálogo muda raramente: cache longo. */
export const useStacks = () =>
  useQuery({
    queryKey: ['catalog', 'stacks'],
    queryFn: () => unwrap(api.GET('/v1/catalog/stacks')).then((r) => r.items),
    staleTime: 60 * 60_000,
  });

export const useLevels = () =>
  useQuery({
    queryKey: ['catalog', 'levels'],
    queryFn: () => unwrap(api.GET('/v1/catalog/levels')).then((r) => r.items),
    staleTime: 60 * 60_000,
  });

/** Toda mutação do perfil devolve o perfil atualizado: grava direto no cache. */
export const useSetFreelancerProfile = () => {
  const queryClient = useQueryClient();
  return useCallback(
    (profile: FreelancerProfile) => queryClient.setQueryData(freelancerProfileKey, profile),
    [queryClient],
  );
};
