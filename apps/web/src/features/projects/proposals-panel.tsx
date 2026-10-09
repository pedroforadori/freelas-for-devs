'use client';

import { unwrap } from '@f4d/api-client';
import {
  type Project,
  type ProposalForClient,
  SELECTION_FEEDBACK_LABELS,
  type SelectionFeedbackReason,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';
import { formatPriceRange } from './format';
import { projectKey } from './queries';

const brl = (cents: number) => formatPriceRange({ minCents: cents, maxCents: cents });

/** Propostas recebidas (rodada em andamento) e a escolha do cliente. */
export function ProposalsPanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const proposalsKey = ['projects', project.id, 'proposals'];
  const query = useQuery({
    queryKey: proposalsKey,
    queryFn: () =>
      unwrap(
        api.GET('/v1/projects/{projectId}/proposals', {
          params: { path: { projectId: project.id } },
        }),
      ),
    refetchInterval: project.status === 'DISTRIBUTING' ? 30_000 : false,
  });
  const [choosing, setChoosing] = useState<ProposalForClient | null>(null);

  if (query.isPending) return <p role="status">Carregando propostas…</p>;
  if (query.isError) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  const { proposals, awaitingResponses } = query.data;
  const hiring = project.status === 'HIRING';
  const chosen = proposals.find((proposal) => proposal.status === 'SELECTED_PENDING_PAYMENT');

  return (
    <Card tone={hiring ? 'accent' : 'surface'} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-h4 font-medium">
          {hiring ? 'Proposta escolhida' : `Propostas (${proposals.length})`}
        </h2>
        <p className="text-body">
          {hiring
            ? 'O próximo passo é o pagamento, que fica em custódia na plataforma até você aprovar a entrega final. (Pagamentos chegam na próxima etapa da plataforma.)'
            : awaitingResponses > 0
              ? `${awaitingResponses} dev(s) convidado(s) ainda vão responder. Novas propostas chegam por e-mail.`
              : 'Devs compatíveis são convidados em rodadas; quem recusa passa a vez para o próximo.'}
        </p>
      </div>

      {proposals.length === 0 ? (
        <p className="text-body text-muted">Nenhuma proposta ainda.</p>
      ) : null}

      <ul className="flex flex-col gap-4">
        {(hiring && chosen ? [chosen] : proposals).map((proposal) => (
          <li key={proposal.invitationId}>
            <ProposalCard
              proposal={proposal}
              onChoose={hiring ? null : () => setChoosing(proposal)}
            />
          </li>
        ))}
      </ul>

      {choosing ? (
        <ChooseDialog
          projectId={project.id}
          chosen={choosing}
          others={proposals.filter((p) => p.invitationId !== choosing.invitationId)}
          onCancel={() => setChoosing(null)}
          onDone={(result) => {
            queryClient.setQueryData(proposalsKey, result);
            void queryClient.invalidateQueries({ queryKey: projectKey(project.id) });
            setChoosing(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function ProposalCard({
  proposal,
  onChoose,
}: {
  proposal: ProposalForClient;
  onChoose: (() => void) | null;
}) {
  const { freelancer } = proposal;
  return (
    <article className="flex flex-col gap-4 rounded-[24px] border border-dark bg-bg p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-h4 font-medium">{freelancer.displayName}</p>
          <p className="text-body">{freelancer.headline}</p>
          <div className="flex flex-wrap gap-2">
            {freelancer.level ? <Badge tone="accent">{freelancer.level.name}</Badge> : null}
            {freelancer.stacks.slice(0, 6).map((slug) => (
              <Badge key={slug}>{slug}</Badge>
            ))}
            <Badge>{freelancer.portfolioItems} no portfólio</Badge>
          </div>
        </div>
        <div className="text-right">
          <p className="text-h4 font-medium">{brl(proposal.amountCents)}</p>
          <p className="text-sm">{proposal.deadlineDays} dias</p>
        </div>
      </div>
      <p className="text-body whitespace-pre-line">{proposal.message}</p>
      {onChoose ? (
        <Button className="h-12 self-start px-6" onClick={onChoose}>
          Escolher esta proposta
        </Button>
      ) : null}
    </article>
  );
}

function ChooseDialog({
  projectId,
  chosen,
  others,
  onCancel,
  onDone,
}: {
  projectId: string;
  chosen: ProposalForClient;
  others: ProposalForClient[];
  onCancel: () => void;
  onDone: (result: Awaited<ReturnType<typeof select>>) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, SelectionFeedbackReason[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const toggle = (invitationId: string, reason: SelectionFeedbackReason) =>
    setReasons((current) => {
      const list = current[invitationId] ?? [];
      return {
        ...current,
        [invitationId]: list.includes(reason)
          ? list.filter((r) => r !== reason)
          : [...list, reason],
      };
    });

  const confirm = async () => {
    setError(null);
    setPending(true);
    try {
      onDone(
        await select(projectId, {
          invitationId: chosen.invitationId,
          feedback: Object.entries(reasons)
            .filter(([, list]) => list.length > 0)
            .map(([invitationId, list]) => ({ invitationId, reasons: list })),
        }),
      );
    } catch (selectError) {
      setError(errorMessage(selectError));
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="choose-title"
      className="flex flex-col gap-5 rounded-[24px] border-2 border-dark bg-bg p-5"
    >
      <h3 id="choose-title" className="text-h4 font-medium">
        Escolher {chosen.freelancer.displayName} por {brl(chosen.amountCents)}?
      </h3>
      {others.length > 0 ? (
        <div className="flex flex-col gap-4">
          <p className="text-body">
            Opcional e anônimo: conte por que não escolheu os demais. Isso ajuda devs iniciantes a
            melhorar as próximas propostas.
          </p>
          {others.map((other) => (
            <fieldset key={other.invitationId} className="flex flex-col gap-2">
              <legend className="font-medium">{other.freelancer.displayName}</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  Object.entries(SELECTION_FEEDBACK_LABELS) as [SelectionFeedbackReason, string][]
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="cursor-pointer rounded-pill border border-dark px-3 py-1.5 text-sm has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-dark"
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={(reasons[other.invitationId] ?? []).includes(value)}
                      onChange={() => toggle(other.invitationId, value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button disabled={pending} onClick={() => void confirm()}>
          {pending ? 'Confirmando…' : 'Confirmar escolha'}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Voltar
        </Button>
      </div>
    </section>
  );
}

const select = (
  projectId: string,
  body: {
    invitationId: string;
    feedback: { invitationId: string; reasons: SelectionFeedbackReason[] }[];
  },
) =>
  unwrap(
    api.POST('/v1/projects/{projectId}/selection', {
      params: { path: { projectId } },
      body,
    }),
  );
