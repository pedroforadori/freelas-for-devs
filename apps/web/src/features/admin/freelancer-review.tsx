'use client';

import { unwrap } from '@f4d/api-client';
import { type AdminFreelancerDetail, PROJECT_TYPE_LABELS } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, fieldA11y, Textarea } from '@f4d/ui/components/field';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useLevels } from '@/features/profile/queries';
import { ReputationCard } from '@/features/reputation/reputation-card';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const select = 'rounded-button border border-dark bg-bg px-5 py-4 text-body';

function Decision({ profile }: { profile: AdminFreelancerDetail }) {
  const queryClient = useQueryClient();
  const levels = useLevels();
  const [mode, setMode] = useState<'approve' | 'changes' | 'level' | null>(null);
  const [levelSlug, setLevelSlug] = useState(profile.level?.slug ?? 'iniciante');
  const [text, setText] = useState('');
  const path = { params: { path: { userId: profile.userId } } };

  const decide = useMutation({
    mutationFn: async () => {
      if (mode === 'approve') {
        return unwrap(
          api.POST('/v1/admin/freelancers/{userId}/approve', {
            ...path,
            body: { levelSlug, ...(text ? { note: text } : {}) },
          }),
        );
      }
      if (mode === 'changes') {
        return unwrap(
          api.POST('/v1/admin/freelancers/{userId}/request-changes', {
            ...path,
            body: { reason: text },
          }),
        );
      }
      return unwrap(
        api.POST('/v1/admin/freelancers/{userId}/level', {
          ...path,
          body: { levelSlug, reason: text },
        }),
      );
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin', 'freelancer', profile.userId], updated);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'freelancers'] });
      setMode(null);
      setText('');
    },
  });

  const actions =
    profile.status === 'PENDING_REVIEW'
      ? [
          { value: 'approve' as const, label: 'Aprovar' },
          { value: 'changes' as const, label: 'Pedir ajustes' },
        ]
      : profile.status === 'APPROVED'
        ? [{ value: 'level' as const, label: 'Reclassificar nível' }]
        : [];

  if (actions.length === 0)
    return <p className="text-body text-muted">Nenhuma ação disponível neste status.</p>;

  return (
    <Card tone="surface" className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-3">
        {actions.map((action) => (
          <Button
            key={action.value}
            variant={mode === action.value ? 'primary' : 'outline'}
            onClick={() => setMode(action.value)}
          >
            {action.label}
          </Button>
        ))}
      </div>
      {mode ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            decide.mutate();
          }}
        >
          {mode !== 'changes' ? (
            <Field id="level" label="Nível">
              <select
                id="level"
                className={select}
                value={levelSlug}
                onChange={(e) => setLevelSlug(e.target.value)}
              >
                {levels.data?.map((level) => (
                  <option key={level.slug} value={level.slug}>
                    {level.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field
            id="decision-text"
            label={
              mode === 'approve'
                ? 'Observação interna (opcional)'
                : mode === 'changes'
                  ? 'O que o freelancer precisa ajustar'
                  : 'Motivo da reclassificação'
            }
            hint={mode === 'changes' ? 'Será enviado ao freelancer por e-mail.' : undefined}
          >
            <Textarea
              {...fieldA11y('decision-text', undefined, mode === 'changes')}
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          {decide.isError ? <Alert tone="error">{errorMessage(decide.error)}</Alert> : null}
          <Button
            type="submit"
            className="self-start"
            disabled={decide.isPending || (mode !== 'approve' && text.trim().length < 10)}
          >
            {decide.isPending ? 'Salvando…' : 'Confirmar'}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

export function FreelancerReview({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'freelancer', userId],
    queryFn: () =>
      unwrap(api.GET('/v1/admin/freelancers/{userId}', { params: { path: { userId } } })),
  });
  if (query.isError) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  if (!query.data) return <p role="status">Carregando…</p>;
  const p = query.data;

  return (
    <>
      <Link href="/admin/freelancers" className="underline">
        ← Voltar para a fila
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-h2 font-medium">{p.displayName}</h1>
        <p className="text-body text-muted">{p.email}</p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="dark">{p.status}</Badge>
          {p.level ? <Badge tone="accent">Nível {p.level.name}</Badge> : null}
          <Badge>{p.available ? 'Disponível' : 'Indisponível'}</Badge>
        </div>
      </div>

      <Decision profile={p} />
      <AdminReputation userId={userId} />
      <ContractStats userId={userId} />

      <Card tone="white" className="flex flex-col gap-4">
        <h2 className="text-h4 font-medium">{p.headline || 'Sem título'}</h2>
        <p className="whitespace-pre-line text-body">{p.bio || 'Sem apresentação.'}</p>
        <div className="flex flex-wrap gap-2">
          {p.projectTypes.map((type) => (
            <Badge key={type} tone="accent">
              {PROJECT_TYPE_LABELS[type]}
            </Badge>
          ))}
          {p.stacks.map((slug) => (
            <Badge key={slug}>{slug}</Badge>
          ))}
        </div>
        <ul className="flex flex-col gap-1 text-body">
          {Object.entries(p.links).map(([kind, url]) => (
            <li key={kind}>
              {kind}:{' '}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="break-all underline"
              >
                {url}
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="text-h3 font-medium">Portfólio ({p.portfolio.length})</h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {p.portfolio.map((item) => (
            <li key={item.id}>
              <Card tone="white" className="flex h-full flex-col gap-2">
                <h3 className="text-h4 font-medium">{item.title}</h3>
                <p className="text-body">{item.description}</p>
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all underline"
                  >
                    {item.url}
                  </a>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-medium">Histórico de nível</h2>
        {p.levelHistory.length === 0 ? (
          <p className="text-body text-muted">Sem alterações.</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {p.levelHistory.map((entry) => (
            <li key={entry.changedAt} className="text-body">
              {dateFormat.format(new Date(entry.changedAt))}: {entry.from ?? '—'} →{' '}
              <strong>{entry.to}</strong> · {entry.reason}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Histórico de contratos como dev: concluídos, disputas, abandonos e pedidos fora de escopo. */
function ContractStats({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'users', userId, 'contract-stats'],
    queryFn: () =>
      unwrap(api.GET('/v1/admin/users/{userId}/contract-stats', { params: { path: { userId } } })),
  });
  const stats = query.data?.asFreelancer;
  if (!stats || stats.contracts === 0) return null;
  const items: [string, string | number][] = [
    ['Contratos', stats.contracts],
    ['Concluídos', stats.completed],
    ['Encerrados pela mediação', stats.settledByMediation],
    ['Disputas abertas por ele', stats.disputesOpened],
    ['Abandonos', stats.abandonments],
    ['Pedidos fora de escopo', stats.outOfScopeFlagged],
    ['…dos quais estavam no escopo', stats.outOfScopeRuledInScope],
    [
      'Parte média reconhecida em disputas',
      stats.averageShareBps === null ? '—' : `${stats.averageShareBps / 100}%`,
    ],
  ];
  return (
    <Card tone="white" className="flex flex-col gap-4">
      <h2 className="text-h4 font-medium">Histórico de contratos</h2>
      <dl className="grid gap-3 text-body sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function AdminReputation({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'freelancer', userId, 'reputation'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/admin/freelancers/{userId}/reputation', { params: { path: { userId } } }),
      ),
  });
  if (!query.data?.level) return null;
  return <ReputationCard reputation={query.data} viewer="admin" />;
}
