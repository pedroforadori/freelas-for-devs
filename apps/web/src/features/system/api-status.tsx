'use client';

import { unwrap } from '@f4d/api-client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const apiStatusQuery = {
  queryKey: ['system', 'liveness'] as const,
  queryFn: () => unwrap(api.GET('/v1/health')),
};

/** Indicador de conectividade com a API — prova o caminho web → api-client → contrato → API. */
export function ApiStatus() {
  const { data, isPending, isError } = useQuery(apiStatusQuery);

  const label = isPending
    ? 'verificando…'
    : isError
      ? 'indisponível'
      : `online (v${data?.version ?? '?'})`;
  const dot = isPending ? 'bg-muted' : isError ? 'bg-red-500' : 'bg-accent';

  return (
    <p className="inline-flex items-center gap-2 text-body" role="status" aria-live="polite">
      <span className={`size-3 rounded-full border border-dark ${dot}`} aria-hidden />
      API: {label}
    </p>
  );
}
