'use client';

import { unwrap } from '@f4d/api-client';
import { CONTRACT_STATUS_LABELS, DELIVERY_STAGE_LABELS } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { dateTime } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

export function ContractList() {
  const query = useQuery({
    queryKey: ['contracts', 'mine'],
    queryFn: () => unwrap(api.GET('/v1/me/contracts')).then((result) => result.items),
  });
  return (
    <>
      <SectionHeading title="Contratos">
        Projetos contratados: entregas, revisões e pagamento.
      </SectionHeading>
      {query.isError ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {query.isPending ? <p role="status">Carregando…</p> : null}
      {query.data?.length === 0 ? (
        <p className="text-body text-muted">Nenhum contrato ainda.</p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {(query.data ?? []).map((contract) => (
          <li key={contract.id}>
            <Link
              href={`/contratos/${contract.id}`}
              className="flex flex-col gap-2 rounded-[30px] border border-dark bg-bg p-6 transition hover:shadow-brutal md:flex-row md:items-center md:justify-between"
            >
              <span className="flex flex-col gap-1">
                <span className="text-h4 font-medium">{contract.project.title}</span>
                <span className="text-sm text-muted">
                  {contract.role === 'CLIENT' ? 'Dev' : 'Cliente'}:{' '}
                  {contract.counterpart.displayName} · atualizado em{' '}
                  {dateTime.format(new Date(contract.updatedAt))}
                </span>
              </span>
              <Badge tone={contract.stage ? 'accent' : 'neutral'}>
                {contract.stage
                  ? DELIVERY_STAGE_LABELS[contract.stage]
                  : CONTRACT_STATUS_LABELS[contract.status]}
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
