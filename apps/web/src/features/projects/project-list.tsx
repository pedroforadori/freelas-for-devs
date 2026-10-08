'use client';

import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button, buttonClasses } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import Link from 'next/link';
import { errorMessage } from '@/lib/problem';
import { dateTime } from './format';
import { useMyProjects } from './queries';

export function ProjectList() {
  const query = useMyProjects();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <SectionHeading title="Projetos">Acompanhe estimativas, escopo e propostas.</SectionHeading>
        <Link href="/novo-projeto" className={buttonClasses('primary', 'self-start md:self-auto')}>
          Publicar projeto
        </Link>
      </div>
      {query.isError ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {query.isPending ? <p role="status">Carregando…</p> : null}
      {!query.isPending && items.length === 0 ? (
        <Card tone="surface" className="flex flex-col gap-3">
          <h2 className="text-h4 font-medium">Nenhum projeto ainda</h2>
          <p className="text-body">
            Descreva sua ideia em poucos minutos e receba uma estimativa de preço e prazo na hora.
          </p>
        </Card>
      ) : null}
      <ul className="flex flex-col gap-4">
        {items.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projetos/${project.id}`}
              className="flex flex-col gap-2 rounded-[30px] border border-dark bg-bg p-6 transition hover:shadow-brutal md:flex-row md:items-center md:justify-between"
            >
              <span className="flex flex-col gap-1">
                <span className="text-h4 font-medium">{project.title}</span>
                <span className="text-sm text-muted">
                  {PROJECT_TYPE_LABELS[project.type]} ·{' '}
                  {dateTime.format(new Date(project.createdAt))}
                </span>
              </span>
              <Badge tone={project.status === 'AWAITING_CLARIFICATION' ? 'accent' : 'neutral'}>
                {PROJECT_STATUS_LABELS[project.status]}
              </Badge>
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
