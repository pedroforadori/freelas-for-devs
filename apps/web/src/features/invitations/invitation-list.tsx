'use client';

import { INVITATION_STATUS_LABELS, PROJECT_TYPE_LABELS } from '@f4d/contracts';
import { cn } from '@f4d/ui/cn';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import Link from 'next/link';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { formatPriceRange } from '@/features/projects/format';
import { errorMessage } from '@/lib/problem';
import { useMyInvitations, timeLeft } from './queries';
import { QueueStatusCard } from './queue-status';

const VIEWS = [
  { value: 'open', label: 'Em aberto' },
  { value: 'history', label: 'Histórico' },
] as const;

export function InvitationList() {
  const [view, setView] = useQueryState(
    'view',
    parseAsStringLiteral(['open', 'history'] as const).withDefault('open'),
  );
  const query = useMyInvitations(view);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <SectionHeading title="Convites">
        Projetos com escopo fechado, enviados a você pela fila. Responda no prazo: quem não responde
        perde a vez.
      </SectionHeading>
      <QueueStatusCard />
      <div role="tablist" aria-label="Convites" className="flex flex-wrap gap-2">
        {VIEWS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={view === tab.value}
            onClick={() => void setView(tab.value)}
            className={cn(
              'rounded-pill border border-dark px-4 py-1.5',
              view === tab.value ? 'bg-dark text-white' : 'hover:bg-surface',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {query.isError ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {query.isPending ? <p role="status">Carregando…</p> : null}
      {!query.isPending && items.length === 0 ? (
        <p className="text-body text-muted">
          {view === 'open'
            ? 'Nenhum convite em aberto. Você recebe um e-mail quando chegar a sua vez.'
            : 'Nada no histórico ainda.'}
        </p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {items.map((invitation) => (
          <li key={invitation.id}>
            <Link
              href={`/convites/${invitation.id}`}
              className="flex flex-col gap-3 rounded-[30px] border border-dark bg-bg p-6 transition hover:shadow-brutal md:flex-row md:items-center md:justify-between"
            >
              <span className="flex flex-col gap-1">
                <span className="text-h4 font-medium">{invitation.project.title}</span>
                <span className="text-sm text-muted">
                  {PROJECT_TYPE_LABELS[invitation.project.type]} ·{' '}
                  {formatPriceRange(invitation.project.priceRange)} · até{' '}
                  {invitation.project.deadlineDays} dias
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {invitation.status === 'INVITED' ? (
                  <Badge tone="accent">Responder em {timeLeft(invitation.deadlineAt)}</Badge>
                ) : null}
                <Badge tone={invitation.status === 'INVITED' ? 'dark' : 'neutral'}>
                  {INVITATION_STATUS_LABELS[invitation.status]}
                </Badge>
              </span>
            </Link>
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
