'use client';

import { unwrap } from '@f4d/api-client';
import type { Project } from '@f4d/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '@/lib/api';

export const projectKey = (projectId: string) => ['projects', projectId] as const;

/** Intervalo de atualização enquanto a IA trabalha (a F3 troca o polling por WebSocket). */
const ESTIMATING_POLL_MS = 2_000;

export const useProject = (projectId: string) =>
  useQuery({
    queryKey: projectKey(projectId),
    queryFn: () => unwrap(api.GET('/v1/projects/{projectId}', { params: { path: { projectId } } })),
    refetchInterval: (query) =>
      query.state.data?.status === 'ESTIMATING' ? ESTIMATING_POLL_MS : false,
  });

export const useMyProjects = () =>
  useInfiniteQuery({
    queryKey: ['projects', 'mine'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/projects', {
          params: { query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

/** Toda mutação do projeto devolve o projeto atualizado: grava direto no cache. */
export const useSetProject = () => {
  const queryClient = useQueryClient();
  return useCallback(
    (project: Project) => {
      queryClient.setQueryData(projectKey(project.id), project);
      void queryClient.invalidateQueries({ queryKey: ['projects', 'mine'] });
    },
    [queryClient],
  );
};
