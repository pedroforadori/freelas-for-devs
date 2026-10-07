'use client';

import { unwrap } from '@f4d/api-client';
import { type FreelancerProfileStatus } from '@f4d/contracts';
import { cn } from '@f4d/ui/cn';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const TABS: { value: FreelancerProfileStatus; label: string }[] = [
  { value: 'PENDING_REVIEW', label: 'Em análise' },
  { value: 'CHANGES_REQUESTED', label: 'Ajustes pedidos' },
  { value: 'APPROVED', label: 'Aprovados' },
  { value: 'DRAFT', label: 'Rascunhos' },
];

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function ReviewQueue() {
  const [status, setStatus] = useQueryState(
    'status',
    parseAsStringLiteral(TABS.map((t) => t.value)).withDefault('PENDING_REVIEW'),
  );
  const query = useInfiniteQuery({
    queryKey: ['admin', 'freelancers', status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/admin/freelancers', {
          params: { query: { status, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <SectionHeading title="Freelancers">
        Analise perfis em ordem de chegada — os mais antigos primeiro.
      </SectionHeading>
      <div role="tablist" aria-label="Status do perfil" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={status === tab.value}
            onClick={() => void setStatus(tab.value)}
            className={cn(
              'rounded-pill border border-dark px-4 py-1.5',
              status === tab.value ? 'bg-dark text-white' : 'hover:bg-surface',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {query.isError ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {query.isPending ? <p role="status">Carregando…</p> : null}
      {!query.isPending && items.length === 0 ? (
        <p className="text-body text-muted">Nada por aqui.</p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.userId}>
            <Card
              tone="white"
              className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-1">
                <p className="text-h4 font-medium">{item.displayName}</p>
                <p className="text-body">
                  {item.headline || <span className="text-muted">Sem título</span>}
                </p>
                <p className="text-sm text-muted">
                  {item.email}
                  {item.submittedAt
                    ? ` · enviado em ${dateFormat.format(new Date(item.submittedAt))}`
                    : ''}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {item.level ? <Badge tone="accent">{item.level.name}</Badge> : null}
                  {item.stacks.slice(0, 6).map((slug) => (
                    <Badge key={slug}>{slug}</Badge>
                  ))}
                </div>
              </div>
              <Link
                href={`/admin/freelancers/${item.userId}`}
                className="self-start rounded-button bg-dark px-6 py-3 text-white md:self-center"
              >
                Abrir
              </Link>
            </Card>
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          className="self-center"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </Button>
      ) : null}
    </>
  );
}
