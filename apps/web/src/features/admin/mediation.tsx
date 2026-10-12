'use client';

import { unwrap } from '@f4d/api-client';
import {
  abandonContractSchema,
  type AdminContract,
  computeSettlement,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  OUT_OF_SCOPE_STATUS_LABELS,
  outOfScopeRulingSchema,
  resolveDisputeSchema,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, Textarea } from '@f4d/ui/components/field';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Attachments } from '@/features/contracts/issues';
import { dateTime, formatPriceRange } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage, problemOf } from '@/lib/problem';

const brl = (cents: number) => formatPriceRange({ minCents: cents, maxCents: cents });
const ROLE_NAMES = { CLIENT: 'Cliente', FREELANCER: 'Dev', ADMIN: 'Mediação' } as const;

/** Recarrega o contrato do projeto (e a lista de disputas) depois de uma decisão. */
const useRefresh = (projectId: string) => {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'projects', 'contract', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'disputes'] });
  };
};

/** Mediação no painel do projeto: contestações de escopo, disputa e abandono. */
export function Mediation({ contract, projectId }: { contract: AdminContract; projectId: string }) {
  const contested = contract.outOfScope.filter((request) => request.status === 'CONTESTED');
  const others = contract.outOfScope.filter((request) => request.status !== 'CONTESTED');
  return (
    <>
      {contract.dispute ? (
        <DisputeReview contract={contract} projectId={projectId} />
      ) : contract.status === 'ACTIVE' ? (
        <DeclareAbandonment contract={contract} projectId={projectId} />
      ) : null}
      {contested.map((request) => (
        <Ruling key={request.id} contract={contract} request={request} projectId={projectId} />
      ))}
      {others.length > 0 ? (
        <Card tone="white" className="flex flex-col gap-3 border border-dark">
          <h2 className="text-h4 font-medium">Pedidos fora do escopo</h2>
          <ul className="flex flex-col gap-3">
            {others.map((request) => (
              <li key={request.id} className="flex flex-col gap-1 border-b border-dark/10 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{OUT_OF_SCOPE_STATUS_LABELS[request.status]}</Badge>
                  <span className="text-sm text-muted">
                    {brl(request.clientTotalCents)} · +{request.extraDays} dias ·{' '}
                    {dateTime.format(new Date(request.createdAt))}
                  </span>
                </div>
                <p className="text-body whitespace-pre-line">{request.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function Ruling({
  contract,
  request,
  projectId,
}: {
  contract: AdminContract;
  request: AdminContract['outOfScope'][number];
  projectId: string;
}) {
  const refresh = useRefresh(projectId);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rule = useMutation({
    mutationFn: (decision: 'IN_SCOPE' | 'OUT_OF_SCOPE') => {
      const parsed = outOfScopeRulingSchema.safeParse({ decision, note });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
      return unwrap(
        api.POST('/v1/admin/contracts/{contractId}/out-of-scope/{requestId}/ruling', {
          params: { path: { contractId: contract.id, requestId: request.id } },
          body: parsed.data,
        }),
      );
    },
    onSuccess: refresh,
    onError: (ruleError) =>
      setError(problemOf(ruleError) ? errorMessage(ruleError) : ruleError.message),
  });
  const id = `ruling-${request.id}`;
  return (
    <Card tone="white" className="flex flex-col gap-4 border-2 border-dark">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="dark">Contestação de escopo</Badge>
        <span className="text-sm text-muted">
          Adicional proposto: {brl(request.clientTotalCents)} · +{request.extraDays} dias
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Pedido marcado pelo dev</p>
        <p className="text-body whitespace-pre-line">{request.description}</p>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Contestação do cliente</p>
        <p className="text-body whitespace-pre-line">{request.contestReason}</p>
      </div>
      <p className="text-sm text-muted">
        Compare com o escopo aprovado (acima) e a conversa do contrato (abaixo).
      </p>
      <Field id={id} label="Justificativa (vai para as duas partes)">
        <Textarea id={id} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button disabled={rule.isPending} onClick={() => rule.mutate('IN_SCOPE')}>
          Estava no escopo
        </Button>
        <Button
          variant="outline"
          disabled={rule.isPending}
          onClick={() => rule.mutate('OUT_OF_SCOPE')}
        >
          Está fora do escopo
        </Button>
      </div>
    </Card>
  );
}

function DisputeReview({ contract, projectId }: { contract: AdminContract; projectId: string }) {
  const dispute = contract.dispute!;
  const r = dispute.resolution;
  return (
    <Card tone="white" className="flex flex-col gap-5 border-2 border-dark" id="disputa">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="dark">{DISPUTE_STATUS_LABELS[dispute.status]}</Badge>
          <Badge>{DISPUTE_REASON_LABELS[dispute.reason]}</Badge>
        </div>
        <h2 className="text-h4 font-medium">
          {dispute.kind === 'ABANDONMENT' ? 'Abandono' : 'Disputa'} · aberta por{' '}
          {ROLE_NAMES[dispute.openedBy].toLowerCase()}
        </h2>
        <p className="text-sm text-muted">
          {dateTime.format(new Date(dispute.createdAt))} · manifestações até{' '}
          {dateTime.format(new Date(dispute.evidenceDeadlineAt))}
        </p>
      </div>
      <p className="text-body whitespace-pre-line">{dispute.description}</p>
      {dispute.statements.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {dispute.statements.map((statement) => (
            <li
              key={statement.createdAt}
              className="flex flex-col gap-2 rounded-button bg-surface p-4"
            >
              <span className="text-sm text-muted">
                {ROLE_NAMES[statement.role]} · {dateTime.format(new Date(statement.createdAt))}
              </span>
              <p className="text-body whitespace-pre-line">{statement.text}</p>
              {statement.attachments.length > 0 ? (
                <Attachments files={statement.attachments} />
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-body text-muted">Nenhuma das partes enviou sua versão ainda.</p>
      )}
      {r ? (
        <Card tone="accent" className="flex flex-col gap-2">
          <p className="font-medium">Decisão: {r.freelancerShareBps / 100}% ao dev</p>
          <p className="text-body">
            Dev recebe {brl(r.freelancerCents)} · comissão {brl(r.platformFeeCents)} · cliente
            recebe de volta {brl(r.refundCents)}
          </p>
          <p className="text-body whitespace-pre-line">{r.note}</p>
        </Card>
      ) : dispute.status === 'OPEN' || dispute.status === 'UNDER_REVIEW' ? (
        <ResolveForm contract={contract} projectId={projectId} />
      ) : null}
    </Card>
  );
}

function ResolveForm({ contract, projectId }: { contract: AdminContract; projectId: string }) {
  const refresh = useRefresh(projectId);
  const [percent, setPercent] = useState(50);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const bps = Math.round(percent * 100);
  const preview = computeSettlement(contract.amounts, bps);
  const resolve = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/admin/disputes/{disputeId}/resolve', {
          params: { path: { disputeId: contract.dispute!.id } },
          body: { freelancerShareBps: bps, note },
        }),
      ),
    onSuccess: refresh,
    onError: (resolveError) => setError(errorMessage(resolveError)),
  });
  const review = () => {
    const parsed = resolveDisputeSchema.safeParse({ freelancerShareBps: bps, note });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira a decisão.');
      return;
    }
    setError(null);
    setConfirming(true);
  };
  return (
    <div className="flex flex-col gap-4 border-t border-dark/20 pt-4">
      <h3 className="font-medium">Decidir</h3>
      <Field id="share" label={`Parte reconhecida ao dev: ${percent}%`}>
        <input
          id="share"
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          onChange={(event) => {
            setPercent(Number(event.target.value));
            setConfirming(false);
          }}
          className="w-full accent-dark"
        />
      </Field>
      <dl className="grid gap-3 text-body sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted">Dev recebe</dt>
          <dd className="font-medium">{brl(preview.freelancerCents)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Comissão da plataforma</dt>
          <dd>{brl(preview.platformFeeCents)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Cliente recebe de volta</dt>
          <dd className="font-medium">{brl(preview.refundCents)}</dd>
        </div>
      </dl>
      <Field id="resolution-note" label="Justificativa (vai para as duas partes)">
        <Textarea
          id="resolution-note"
          value={note}
          maxLength={4000}
          onChange={(event) => {
            setNote(event.target.value);
            setConfirming(false);
          }}
        />
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {confirming ? (
        <Alert tone="error" title="Confirme a decisão">
          O reembolso e o repasse são executados em seguida e não podem ser desfeitos.
          <div className="mt-3 flex flex-wrap gap-3">
            <Button disabled={resolve.isPending} onClick={() => resolve.mutate()}>
              {resolve.isPending ? 'Decidindo…' : 'Confirmar decisão'}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Revisar
            </Button>
          </div>
        </Alert>
      ) : (
        <div>
          <Button onClick={review}>Decidir a disputa</Button>
        </div>
      )}
    </div>
  );
}

function DeclareAbandonment({
  contract,
  projectId,
}: {
  contract: AdminContract;
  projectId: string;
}) {
  const refresh = useRefresh(projectId);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const declare = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/admin/contracts/{contractId}/abandonment', {
          params: { path: { contractId: contract.id } },
          body: { description },
        }),
      ),
    onSuccess: () => {
      setOpen(false);
      refresh();
    },
    onError: (declareError) => setError(errorMessage(declareError)),
  });
  if (!open)
    return (
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Declarar abandono pelo dev…
        </Button>
      </div>
    );
  return (
    <Card tone="surface" className="flex flex-col gap-4">
      <h2 className="text-h4 font-medium">Declarar abandono</h2>
      <p className="text-body">
        Use quando o dev sumiu. O contrato congela, as partes são avisadas e o dev vai para o fim da
        fila. Depois, decida o destino da custódia.
      </p>
      <Field id="abandonment" label="O que aconteceu">
        <Textarea
          id="abandonment"
          value={description}
          maxLength={4000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={declare.isPending}
          onClick={() => {
            const parsed = abandonContractSchema.safeParse({ description });
            if (!parsed.success) setError(parsed.error.issues[0]?.message ?? 'Descreva o caso.');
            else declare.mutate();
          }}
        >
          Declarar abandono
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}
