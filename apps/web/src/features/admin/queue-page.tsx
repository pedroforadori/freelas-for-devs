'use client';

import { unwrap } from '@f4d/api-client';
import type { AdminQueueEntry } from '@f4d/contracts';
import { cn } from '@f4d/ui/cn';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { SectionHeading } from '@f4d/ui/components/section-heading';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs';
import { useState } from 'react';
import { useLevels } from '@/features/profile/queries';
import { dateTime } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const STATES = [
  { value: 'ACTIVE', label: 'Na fila' },
  { value: 'MONITORING', label: 'Em acompanhamento' },
] as const;

/** Fila de cada nível na ordem exata de convite, e quem está em acompanhamento. */
export function QueuePage() {
  const levels = useLevels();
  const queryClient = useQueryClient();
  const [state, setState] = useQueryState(
    'state',
    parseAsStringLiteral(['ACTIVE', 'MONITORING'] as const).withDefault('ACTIVE'),
  );
  const [level, setLevel] = useQueryState('nivel', parseAsString.withDefault(''));
  const queryKey = ['admin', 'queue', state, level];
  const query = useQuery({
    queryKey,
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/queue', {
          params: { query: { state: state, ...(level ? { levelSlug: level } : {}) } },
        }),
      ).then((result) => result.items),
  });
  const [error, setError] = useState<string | null>(null);

  const reactivate = async (entry: AdminQueueEntry) => {
    setError(null);
    try {
      await unwrap(
        api.POST('/v1/admin/queue/{userId}/reactivate', {
          params: { path: { userId: entry.userId } },
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ['admin', 'queue'] });
    } catch (reactivateError) {
      setError(errorMessage(reactivateError));
    }
  };

  return (
    <>
      <SectionHeading title="Fila">
        Ordem de convite por nível: prioridade (quem espera há mais tempo) e depois quem foi
        convidado há mais tempo. Recusar ou não responder manda para o fim.
      </SectionHeading>
      <div className="flex flex-wrap items-center gap-2">
        {STATES.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={state === tab.value}
            onClick={() => void setState(tab.value)}
            className={cn(
              'rounded-pill border border-dark px-4 py-1.5',
              state === tab.value ? 'bg-dark text-white' : 'hover:bg-surface',
            )}
          >
            {tab.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-body">
          Nível
          <select
            value={level}
            onChange={(event) => void setLevel(event.target.value || null)}
            className="rounded-button border border-dark bg-bg px-4 py-2"
          >
            <option value="">Todos</option>
            {(levels.data ?? []).map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {query.isError ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {query.isPending ? <p role="status">Carregando…</p> : null}
      {query.data?.length === 0 ? <p className="text-body text-muted">Ninguém por aqui.</p> : null}
      {query.data && query.data.length > 0 ? (
        <div className="overflow-x-auto rounded-[20px] border border-dark">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface">
              <tr>
                {state === 'ACTIVE' ? <th className="p-3">#</th> : null}
                <th className="p-3">Freelancer</th>
                <th className="p-3">Nível</th>
                <th className="p-3">Situação</th>
                <th className="p-3">Último convite</th>
                <th className="p-3">Rodadas sem escolha</th>
                <th className="p-3">Recusas / sem resposta</th>
                <th className="p-3">Contratações</th>
                {state === 'MONITORING' ? <th className="p-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {query.data.map((entry) => (
                <tr key={entry.userId} className="border-t border-dark/20">
                  {state === 'ACTIVE' ? (
                    <td className="p-3 font-medium">{entry.position}</td>
                  ) : null}
                  <td className="p-3">
                    {entry.displayName}
                    {!entry.available ? (
                      <span className="block text-muted">indisponível</span>
                    ) : null}
                  </td>
                  <td className="p-3">{entry.levelSlug}</td>
                  <td className="p-3">
                    {entry.tier === 'PRIORITY' ? <Badge tone="accent">Prioridade</Badge> : 'Normal'}
                  </td>
                  <td className="p-3">
                    {entry.lastInvitedAt ? dateTime.format(new Date(entry.lastInvitedAt)) : 'nunca'}
                  </td>
                  <td className="p-3">{entry.roundsWithoutSelection}</td>
                  <td className="p-3">
                    {entry.declines} / {entry.noResponses}
                  </td>
                  <td className="p-3">{entry.selections}</td>
                  {state === 'MONITORING' ? (
                    <td className="p-3">
                      <Button
                        variant="outline"
                        className="h-10 px-4"
                        onClick={() => void reactivate(entry)}
                      >
                        Reativar
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
