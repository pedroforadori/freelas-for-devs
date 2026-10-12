'use client';

import { unwrap } from '@f4d/api-client';
import { emailSchema } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, Textarea } from '@f4d/ui/components/field';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { dateTime } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';

const betaKey = ['admin', 'beta'] as const;
const PROFILE = { CLIENT: 'Cliente', FREELANCER: 'Dev' } as const;

/** Beta fechado: lista de espera, convites e o modo de cadastro. */
export function BetaPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: betaKey, queryFn: () => unwrap(api.GET('/v1/admin/beta')) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: (emails: string[]) =>
      unwrap(api.POST('/v1/admin/beta/invites', { body: { emails } })),
    onSuccess: () => {
      setSelected(new Set());
      setManual('');
      void queryClient.invalidateQueries({ queryKey: betaKey });
    },
    onError: (inviteError) => setError(errorMessage(inviteError)),
  });
  const data = query.data;
  const pending = data?.waitlist.filter((entry) => !entry.invitedAt) ?? [];

  const inviteManual = () => {
    const emails = manual.split(/[\s,;]+/).filter(Boolean);
    const invalid = emails.filter((email) => !emailSchema.safeParse(email).success);
    if (emails.length === 0 || invalid.length > 0) {
      setError(
        invalid.length ? `E-mails inválidos: ${invalid.join(', ')}` : 'Informe ao menos um e-mail.',
      );
      return;
    }
    setError(null);
    invite.mutate(emails);
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-h3 font-medium">Beta fechado</h1>
        <p className="text-body text-muted">
          Convide pessoas da lista de espera: elas recebem um e-mail e passam a poder criar conta
          (por senha ou login social).
        </p>
      </div>
      {data ? (
        <Alert
          tone={data.signupMode === 'INVITE_ONLY' ? 'success' : 'info'}
          title={
            data.signupMode === 'INVITE_ONLY'
              ? 'Cadastro: só convidados'
              : 'Cadastro: aberto a todos'
          }
        >
          Altere em{' '}
          <Link href="/admin/configuracoes" className="underline">
            Configurações → Cadastro de novas contas
          </Link>
          .
        </Alert>
      ) : null}
      {query.isError ? <Alert tone="error">{errorMessage(query.error)}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card tone="white" className="flex flex-col gap-4 border border-dark">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-h4 font-medium">Lista de espera ({data?.waitlist.length ?? 0})</h2>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={pending.length === 0}
              onClick={() => setSelected(new Set(pending.map((entry) => entry.email)))}
            >
              Selecionar não convidados
            </Button>
            <Button
              disabled={selected.size === 0 || invite.isPending}
              onClick={() => invite.mutate([...selected])}
            >
              Convidar selecionados ({selected.size})
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-dark">
                <th className="py-2 pr-3" />
                <th className="py-2 pr-3">Pessoa</th>
                <th className="py-2 pr-3">Perfil</th>
                <th className="py-2 pr-3">Entrou em</th>
                <th className="py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {data?.waitlist.map((entry) => (
                <tr key={entry.email} className="border-b border-dark/20">
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${entry.email}`}
                      disabled={Boolean(entry.invitedAt)}
                      checked={selected.has(entry.email)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(entry.email);
                        else next.delete(entry.email);
                        setSelected(next);
                      }}
                      className="size-4 accent-dark"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    {entry.name}
                    <span className="block break-all text-muted">{entry.email}</span>
                  </td>
                  <td className="py-2 pr-3">
                    {entry.profiles.map((profile) => PROFILE[profile]).join(' e ')}
                    {entry.mainStack ? (
                      <span className="block text-muted">{entry.mainStack}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{dateTime.format(new Date(entry.joinedAt))}</td>
                  <td className="py-2">
                    {entry.registered ? (
                      <Badge tone="accent">Criou conta</Badge>
                    ) : entry.invitedAt ? (
                      <Badge>Convidado em {dateTime.format(new Date(entry.invitedAt))}</Badge>
                    ) : (
                      <Badge tone="dark">Aguardando convite</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card tone="surface" className="flex flex-col gap-4">
        <h2 className="text-h4 font-medium">Convidar por e-mail</h2>
        <Field id="manual-invites" label="E-mails (um por linha ou separados por vírgula)">
          <Textarea
            id="manual-invites"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
          />
        </Field>
        <div>
          <Button disabled={invite.isPending} onClick={inviteManual}>
            Enviar convites
          </Button>
        </div>
        {data && data.directInvites.length > 0 ? (
          <ul className="flex flex-col gap-1 text-body">
            {data.directInvites.map((entry) => (
              <li key={entry.email} className="break-all">
                {entry.email} ·{' '}
                {entry.registered
                  ? 'criou conta'
                  : `convidado em ${dateTime.format(new Date(entry.invitedAt))}`}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
