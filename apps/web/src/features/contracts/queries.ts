'use client';

import { ApiError, unwrap } from '@f4d/api-client';
import type { Contract } from '@f4d/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const projectContractKey = (projectId: string) =>
  ['contracts', 'project', projectId] as const;

/**
 * Contrato do projeto. Logo após a escolha ele ainda está sendo criado pelo worker (404): a
 * consulta se repete até aparecer; enquanto `confirming`, repete até o pagamento ser confirmado.
 */
export const useProjectContract = (projectId: string, options: { confirming?: boolean } = {}) =>
  useQuery({
    queryKey: projectContractKey(projectId),
    queryFn: async (): Promise<Contract | null> => {
      try {
        return await unwrap(
          api.GET('/v1/projects/{projectId}/contract', { params: { path: { projectId } } }),
        );
      } catch (error) {
        if (error instanceof ApiError && error.problem.status === 404) return null;
        throw error;
      }
    },
    refetchInterval: (query) => {
      const contract = query.state.data;
      if (contract === null) return 2_000;
      if (options.confirming && contract?.status === 'AWAITING_PAYMENT') return 2_000;
      return false;
    },
  });

export const contractKey = (contractId: string) => ['contracts', contractId] as const;

/** Atualiza o contrato em cache com a resposta de uma ação (e a lista "meus contratos"). */
export const useSetContract = (contractId: string) => {
  const queryClient = useQueryClient();
  return (contract: Contract) => {
    queryClient.setQueryData(contractKey(contractId), contract);
    void queryClient.invalidateQueries({ queryKey: ['contracts', 'mine'] });
  };
};
