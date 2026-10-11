'use client';

import { unwrap } from '@f4d/api-client';
import {
  INVITATION_STATUS_LABELS,
  type Invitation,
  PROJECT_TYPE_LABELS,
  PROPOSAL_LIMITS,
  proposalInputSchema,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, fieldA11y, Input, Textarea } from '@f4d/ui/components/field';
import Link from 'next/link';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { dateTime, formatPriceRange } from '@/features/projects/format';
import { ScopeView } from '@/features/projects/scope-view';
import { api } from '@/lib/api';
import { errorMessage, problemOf } from '@/lib/problem';
import { timeLeft, useInvitation, useSetInvitation } from './queries';

export function InvitationDetail({ invitationId }: { invitationId: string }) {
  const query = useInvitation(invitationId);
  if (query.isPending) return <p role="status">Carregando…</p>;
  if (query.isError) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  const invitation = query.data;
  const { project } = invitation;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="dark">{INVITATION_STATUS_LABELS[invitation.status]}</Badge>
          <span className="text-sm text-muted">
            {PROJECT_TYPE_LABELS[project.type]} · convite de{' '}
            {dateTime.format(new Date(invitation.invitedAt))}
          </span>
        </div>
        <h1 className="text-h3 font-medium md:text-h2">{project.title}</h1>
      </div>

      <Respond invitation={invitation} />

      <Card tone="white" className="flex flex-col gap-6">
        <h2 className="text-h4 font-medium">Escopo aprovado</h2>
        <ScopeView scope={project.scope} />
        <details>
          <summary className="cursor-pointer font-medium">Pedido original do cliente</summary>
          <p className="mt-3 text-body whitespace-pre-line">{project.description}</p>
        </details>
      </Card>
    </>
  );
}

function Respond({ invitation }: { invitation: Invitation }) {
  switch (invitation.status) {
    case 'INVITED':
      return (
        <Card tone="accent" className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-h4 font-medium">É a sua vez</h2>
            <p className="text-body">
              Responda em <strong>{timeLeft(invitation.deadlineAt)}</strong> (até{' '}
              {dateTime.format(new Date(invitation.deadlineAt))}). Sem resposta, a vaga vai para o
              próximo da fila e você volta para o fim.
            </p>
          </div>
          <ProposalForm invitation={invitation} />
          <DeclineButton invitation={invitation} />
        </Card>
      );
    case 'PROPOSAL_SUBMITTED':
      return (
        <Card tone="surface" className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-h4 font-medium">Proposta enviada</h2>
            <p className="text-body">
              O cliente está comparando as propostas. Você pode ajustar a sua até ele escolher.
            </p>
          </div>
          <ProposalForm invitation={invitation} />
          <WithdrawButton invitation={invitation} />
        </Card>
      );
    case 'SELECTED_PENDING_PAYMENT':
      return (
        <Alert tone="success" title="O cliente escolheu a sua proposta!">
          Assim que o pagamento for confirmado em custódia, o projeto começa. Avisamos por e-mail.
        </Alert>
      );
    case 'ON_HOLD':
      return (
        <Alert title="Outra proposta foi escolhida">
          Ela aguarda o pagamento do cliente. Se o pagamento não acontecer, a sua proposta volta a
          ser considerada. De todo modo, você ganha prioridade na próxima rodada.
        </Alert>
      );
    case 'NOT_SELECTED':
      return (
        <Alert title="Sua proposta não foi escolhida desta vez">
          Você está na frente da fila para a próxima rodada do seu nível.
        </Alert>
      );
    case 'HIRED':
      return (
        <Alert tone="success" title="Você foi contratado para este projeto">
          Bom trabalho! As entregas acontecem pela{' '}
          <Link href="/contratos" className="underline">
            área de contratos
          </Link>
          .
        </Alert>
      );
    case 'DECLINED':
    case 'EXPIRED':
    case 'WITHDRAWN':
    case 'VOIDED':
      return (
        <Alert title={INVITATION_STATUS_LABELS[invitation.status]}>
          Este convite foi encerrado.
        </Alert>
      );
  }
}

interface ProposalForm {
  amount: number;
  deadlineDays: number;
  message: string;
}

function ProposalForm({ invitation }: { invitation: Invitation }) {
  const setInvitation = useSetInvitation();
  const { scope } = invitation.project;
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );
  const form = useForm<ProposalForm>({
    defaultValues: {
      amount: (invitation.proposal?.amountCents ?? scope.priceRange.minCents) / 100,
      deadlineDays: invitation.proposal?.deadlineDays ?? scope.deadlineDays,
      message: invitation.proposal?.message ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const message = useWatch({ control: form.control, name: 'message' }) ?? '';
  const editing = invitation.proposal !== null;

  const submit = form.handleSubmit(async (values) => {
    setFeedback(null);
    const parsed = proposalInputSchema.safeParse({
      amountCents: Math.round(values.amount * 100),
      deadlineDays: values.deadlineDays,
      message: values.message,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = { amountCents: 'amount', deadlineDays: 'deadlineDays', message: 'message' }[
          String(issue.path[0])
        ] as keyof ProposalForm | undefined;
        if (field) form.setError(field, { message: issue.message });
      }
      return;
    }
    try {
      const updated = await unwrap(
        api.PUT('/v1/invitations/{invitationId}/proposal', {
          params: { path: { invitationId: invitation.id } },
          body: parsed.data,
        }),
      );
      setInvitation(updated);
      setFeedback({
        tone: 'success',
        text: editing ? 'Proposta atualizada.' : 'Proposta enviada.',
      });
    } catch (error) {
      const issue = problemOf(error);
      setFeedback({ tone: 'error', text: issue?.detail ?? errorMessage(error) });
    }
  });

  return (
    <form
      onSubmit={(event) => {
        form.clearErrors();
        void submit(event);
      }}
      className="flex flex-col gap-5"
      noValidate
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field
          id="amount"
          label="Valor (R$)"
          hint={`Dentro da faixa aprovada: ${formatPriceRange(scope.priceRange)}.`}
          error={errors.amount?.message}
        >
          <Input
            {...fieldA11y('amount', errors.amount?.message, true)}
            type="number"
            min={scope.priceRange.minCents / 100}
            max={scope.priceRange.maxCents / 100}
            step={50}
            {...form.register('amount', { valueAsNumber: true })}
          />
        </Field>
        <Field
          id="deadlineDays"
          label="Prazo de entrega (dias)"
          hint={`Até ${scope.deadlineDays} dias.`}
          error={errors.deadlineDays?.message}
        >
          <Input
            {...fieldA11y('deadlineDays', errors.deadlineDays?.message, true)}
            type="number"
            min={1}
            max={scope.deadlineDays}
            {...form.register('deadlineDays', { valueAsNumber: true })}
          />
        </Field>
      </div>
      <Field
        id="message"
        label="Sua proposta"
        hint={`Como você vai fazer, experiências parecidas e o que entrega em cada etapa. ${message.length}/${PROPOSAL_LIMITS.messageMax}`}
        error={errors.message?.message}
      >
        <Textarea
          {...fieldA11y('message', errors.message?.message, true)}
          rows={6}
          maxLength={PROPOSAL_LIMITS.messageMax}
          {...form.register('message')}
        />
      </Field>
      {feedback ? <Alert tone={feedback.tone}>{feedback.text}</Alert> : null}
      <Button type="submit" className="self-start" disabled={isSubmitting}>
        {isSubmitting ? 'Enviando…' : editing ? 'Atualizar proposta' : 'Enviar proposta'}
      </Button>
    </form>
  );
}

function useInvitationAction(invitation: Invitation, path: 'decline' | 'withdraw') {
  const setInvitation = useSetInvitation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setError(null);
    setPending(true);
    try {
      const updated = await unwrap(
        path === 'decline'
          ? api.POST('/v1/invitations/{invitationId}/decline', {
              params: { path: { invitationId: invitation.id } },
            })
          : api.POST('/v1/invitations/{invitationId}/withdraw', {
              params: { path: { invitationId: invitation.id } },
            }),
      );
      setInvitation(updated);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setPending(false);
    }
  };
  return { run, error, pending };
}

function DeclineButton({ invitation }: { invitation: Invitation }) {
  const { run, error, pending } = useInvitationAction(invitation, 'decline');
  return (
    <div className="flex flex-col gap-2 border-t border-dark/20 pt-4">
      <p className="text-sm">Não tem disponibilidade ou o projeto não combina com você?</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        variant="outline"
        className="h-12 self-start px-6"
        disabled={pending}
        onClick={() =>
          void run('Recusar o convite? Você passa a vez e volta para o fim da fila do seu nível.')
        }
      >
        Recusar convite
      </Button>
    </div>
  );
}

function WithdrawButton({ invitation }: { invitation: Invitation }) {
  const { run, error, pending } = useInvitationAction(invitation, 'withdraw');
  return (
    <div className="flex flex-col gap-2 border-t border-dark/20 pt-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        variant="outline"
        className="h-12 self-start px-6"
        disabled={pending}
        onClick={() =>
          void run('Retirar a proposta? Equivale a recusar: você volta para o fim da fila.')
        }
      >
        Retirar proposta
      </Button>
    </div>
  );
}
