'use client';

import { unwrap } from '@f4d/api-client';
import type { Invitation } from '@f4d/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '@/lib/api';

export const invitationKey = (invitationId: string) => ['invitations', invitationId] as const;

export const useMyQueue = () =>
  useQuery({
    queryKey: ['queue', 'me'],
    queryFn: () => unwrap(api.GET('/v1/me/queue')),
  });

export const useMyInvitations = (view: 'open' | 'history') =>
  useInfiniteQuery({
    queryKey: ['invitations', 'mine', view],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/me/invitations', {
          params: { query: { view, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const useInvitation = (invitationId: string) =>
  useQuery({
    queryKey: invitationKey(invitationId),
    queryFn: () =>
      unwrap(api.GET('/v1/invitations/{invitationId}', { params: { path: { invitationId } } })),
  });

/** Toda resposta ao convite devolve o convite atualizado; listas e fila são recarregadas. */
export const useSetInvitation = () => {
  const queryClient = useQueryClient();
  return useCallback(
    (invitation: Invitation) => {
      queryClient.setQueryData(invitationKey(invitation.id), invitation);
      void queryClient.invalidateQueries({ queryKey: ['invitations', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: ['queue', 'me'] });
    },
    [queryClient],
  );
};

/** "faltam 1 dia e 3 h" — prazo do convite. */
export const timeLeft = (deadline: string, now = Date.now()): string => {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return 'prazo encerrado';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'menos de 1 hora';
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return days > 0 ? `${days} d e ${rest} h` : `${hours} h`;
};
