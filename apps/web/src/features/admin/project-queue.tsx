'use client';

import { unwrap } from '@f4d/api-client';
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS, type ProjectStatus } from '@f4d/contracts';
import { cn } from '@f4d/ui/cn';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { dateTime } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const TABS: ProjectStatus[] = ['SCOPING', 'AWAITING_CLARIFICATION', 'ESTIMATING', 'CANCELLED'];

/** Projetos por status, mais antigos primeiro (ordem de atendimento do escopo). */
export function ProjectQueue() {
  const [status, setStatus] = useQueryState(
    'status',
    parseAsStringLiteral(TABS).withDefault('SCOPING'),
  );
  const query = useInfiniteQuery({
    queryKey: ['admin', 'projects', status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/admin/projects', {
          params: { query: { status, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <SectionHeading title="Projetos">
        Projetos publicados por status. Em escopo: os mais antigos primeiro.
      </SectionHeading>
      <div role="tablist" aria-label="Status do projeto" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={status === tab}
            onClick={() => void setStatus(tab)}
            className={cn(
              'rounded-pill border border-dark px-4 py-1.5',
              status === tab ? 'bg-dark text-white' : 'hover:bg-surface',
            )}
          >
            {PROJECT_STATUS_LABELS[tab]}
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
          <li key={item.id}>
            <Card
              tone="white"
              className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-1">
                <p className="text-h4 font-medium">{item.title}</p>
                <p className="text-sm text-muted">
                  {PROJECT_TYPE_LABELS[item.type]} · {item.client.displayName} ({item.client.email})
                  · {dateTime.format(new Date(item.createdAt))}
                </p>
              </div>
              <Link
                href={`/admin/projetos/${item.id}`}
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
