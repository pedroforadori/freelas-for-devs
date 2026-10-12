'use client';

import { unwrap } from '@f4d/api-client';
import { DISPUTE_REASON_LABELS, DISPUTE_STATUS_LABELS } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Card } from '@f4d/ui/components/card';
import { cn } from '@f4d/ui/cn';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { dateTime, formatPriceRange } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const brl = (cents: number) => formatPriceRange({ minCents: cents, maxCents: cents });
const OPENED_BY = { CLIENT: 'cliente', FREELANCER: 'dev', ADMIN: 'mediação' } as const;

/** Disputas e abandonos: o que espera decisão (mais antigos primeiro) e o histórico. */
export function DisputesPage() {
  const [view, setView] = useState<'open' | 'closed'>('open');
  const query = useQuery({
    queryKey: ['admin', 'disputes', view],
    queryFn: () => unwrap(api.GET('/v1/admin/disputes', { params: { query: { view } } })),
  });
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-h3 font-medium">Disputas</h1>
        <p className="text-body text-muted">
          A decisão é tomada na página do projeto, com o escopo, as entregas e a conversa do
          contrato à vista.
        </p>
      </div>
      <div className="flex gap-2" role="tablist" aria-label="Situação">
        {(['open', 'closed'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={cn(
              'rounded-pill border border-dark px-4 py-1.5',
              view === value ? 'bg-dark text-white' : 'hover:bg-surface',
            )}
          >
            {value === 'open' ? 'Em andamento' : 'Encerradas'}
          </button>
        ))}
      </div>
      {query.isPending ? <p role="status">Carregando…</p> : null}
      {query.isError ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {query.data?.items.length === 0 ? (
        <Card tone="surface">
          <p className="text-body">
            {view === 'open'
              ? 'Nenhuma disputa aguardando a mediação.'
              : 'Nenhuma disputa encerrada.'}
          </p>
        </Card>
      ) : null}
      <ul className="flex flex-col gap-4">
        {query.data?.items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/admin/projetos/${item.project.id}#disputa`}
              className="block rounded-card border border-dark bg-bg p-6 shadow-brutal hover:bg-surface"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="dark">{DISPUTE_STATUS_LABELS[item.status]}</Badge>
                <Badge tone={item.kind === 'ABANDONMENT' ? 'accent' : 'neutral'}>
                  {DISPUTE_REASON_LABELS[item.reason]}
                </Badge>
                {item.waitingFor ? <Badge>Aguardando: {item.waitingFor}</Badge> : null}
              </div>
              <p className="mt-3 text-h4 font-medium">{item.project.title}</p>
              <p className="text-body text-muted">
                {item.client.displayName} × {item.freelancer.displayName} ·{' '}
                {brl(item.clientTotalCents)} em custódia · aberta pelo {OPENED_BY[item.openedBy]} em{' '}
                {dateTime.format(new Date(item.createdAt))}
              </p>
              <p className="text-sm text-muted">
                {item.statements} {item.statements === 1 ? 'manifestação' : 'manifestações'} · prazo
                das partes até {dateTime.format(new Date(item.evidenceDeadlineAt))}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
