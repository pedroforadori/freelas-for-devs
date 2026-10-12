'use client';

import { unwrap } from '@f4d/api-client';
import type { ContactViolation } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, fieldA11y, Textarea } from '@f4d/ui/components/field';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { dateTime } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const KIND_LABELS: Record<ContactViolation['kinds'][number], string> = {
  PHONE: 'Telefone',
  EMAIL: 'E-mail',
  URL: 'Link',
  HANDLE: 'Perfil (@)',
  MESSAGING_APP: 'App de mensagem',
};

const SOURCE_LABELS: Record<ContactViolation['source'], string> = {
  CHAT: 'Chat',
  PROPOSAL: 'Proposta',
};

const violationsKey = ['admin', 'moderation', 'violations'] as const;

/** Tentativas de passar contato: texto mascarado, original sob demanda (auditado) e sanções. */
export function ModerationPage() {
  const query = useQuery({
    queryKey: violationsKey,
    queryFn: () =>
      unwrap(api.GET('/v1/admin/moderation/violations', { params: { query: { limit: 100 } } })),
  });

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-h3 font-medium">Moderação</h1>
        <p className="text-body text-muted">
          Mensagens e propostas com telefone, e-mail, links ou apps de mensagem são mascaradas
          automaticamente. Quem repete recebe advertência por e-mail; aqui você decide suspensões.
        </p>
      </div>
      {query.isPending ? <p role="status">Carregando…</p> : null}
      {query.isError ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {query.data?.items.length === 0 ? (
        <Card tone="surface">
          <p className="text-body">Nenhuma tentativa de contato registrada.</p>
        </Card>
      ) : null}
      <ul className="flex flex-col gap-4">
        {query.data?.items.map((violation) => (
          <li key={violation.id}>
            <ViolationCard violation={violation} />
          </li>
        ))}
      </ul>
    </>
  );
}

function ViolationCard({ violation }: { violation: ContactViolation }) {
  const [original, setOriginal] = useState<string | null>(null);
  const reveal = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/admin/moderation/violations/{violationId}/reveal', {
          params: { path: { violationId: violation.id } },
        }),
      ),
    onSuccess: (result) => setOriginal(result.originalText),
  });
  const { user } = violation;
  const repeated = user.recentViolations > 1;

  return (
    <Card tone="white" className="flex flex-col gap-4 border border-dark">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={user.status === 'ACTIVE' ? 'neutral' : 'dark'}>
          {{ ACTIVE: 'Ativo', SUSPENDED: 'Suspenso', DELETED: 'Conta excluída' }[user.status]}
        </Badge>
        <Badge tone={repeated ? 'accent' : 'neutral'}>
          {user.recentViolations} {user.recentViolations === 1 ? 'tentativa' : 'tentativas'} em 30
          dias
        </Badge>
        <Badge>{SOURCE_LABELS[violation.source]}</Badge>
        {violation.kinds.map((kind) => (
          <Badge key={kind}>{KIND_LABELS[kind]}</Badge>
        ))}
      </div>
      <p className="text-body">
        <span className="font-medium">{user.displayName}</span>{' '}
        <span className="break-all text-muted">({user.email})</span> ·{' '}
        {dateTime.format(new Date(violation.createdAt))}
        {violation.projectId ? (
          <>
            {' · '}
            <Link href={`/admin/projetos/${violation.projectId}`} className="underline">
              ver projeto
            </Link>
          </>
        ) : null}
      </p>
      <blockquote className="rounded-button bg-surface px-4 py-3 text-body whitespace-pre-line break-words">
        {violation.maskedText}
      </blockquote>
      {original !== null ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Texto original (acesso registrado na auditoria)</p>
          <blockquote className="rounded-button border border-red-700 bg-red-50 px-4 py-3 text-body whitespace-pre-line break-words">
            {original}
          </blockquote>
        </div>
      ) : null}
      {reveal.isError ? <Alert tone="error">{errorMessage(reveal.error)}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        {original === null ? (
          <Button variant="outline" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
            {reveal.isPending ? 'Abrindo…' : 'Ver original'}
          </Button>
        ) : null}
      </div>
      {user.status === 'DELETED' ? null : (
        <AccountActions userId={user.userId} suspended={user.status === 'SUSPENDED'} />
      )}
    </Card>
  );
}

function AccountActions({ userId, suspended }: { userId: string; suspended: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const done = () => {
    setOpen(false);
    setReason('');
    void queryClient.invalidateQueries({ queryKey: violationsKey });
  };
  const suspend = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/admin/users/{userId}/suspend', {
          params: { path: { userId } },
          body: { reason: reason.trim() },
        }),
      ),
    onSuccess: done,
  });
  const reinstate = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/v1/admin/users/{userId}/reinstate', { params: { path: { userId } } })),
    onSuccess: done,
  });
  const error = suspend.error ?? reinstate.error;
  const id = `reason-${userId}`;

  if (suspended) {
    return (
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
        <div>
          <Button
            variant="outline"
            disabled={reinstate.isPending}
            onClick={() => reinstate.mutate()}
          >
            {reinstate.isPending ? 'Reativando…' : 'Reativar conta'}
          </Button>
        </div>
      </div>
    );
  }
  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Suspender conta…</Button>
      </div>
    );
  }
  const tooShort = reason.trim().length < 10;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooShort) suspend.mutate();
      }}
    >
      <Field
        id={id}
        label="Motivo da suspensão"
        hint="Vai no e-mail para a pessoa. Mínimo de 10 caracteres."
      >
        <Textarea
          {...fieldA11y(id, undefined, true)}
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          className="min-h-24"
        />
      </Field>
      {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
      <p className="text-sm text-muted">
        A pessoa não consegue mais entrar, as sessões abertas expiram em até 15 minutos e ela sai da
        fila de convites.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={tooShort || suspend.isPending}>
          {suspend.isPending ? 'Suspendendo…' : 'Confirmar suspensão'}
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
