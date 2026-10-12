'use client';

import { unwrap } from '@f4d/api-client';
import {
  abandonContractSchema,
  type Contract,
  contestOutOfScopeSchema,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  disputeStatementSchema,
  openDisputeSchema,
  OUT_OF_SCOPE_STATUS_LABELS,
  type OutOfScopeRequest,
  outOfScopeInputSchema,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, fieldA11y, Input, Textarea } from '@f4d/ui/components/field';
import { type ChangeEvent, type ReactNode, useState } from 'react';
import { dateTime, formatFileSize, formatPriceRange } from '@/features/projects/format';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/problem';
import { UploadRejectedError, uploadFile } from '@/lib/upload';
import { useSetContract } from './queries';

type Viewer = 'client' | 'freelancer';
type Dispute = NonNullable<Contract['dispute']>;

const brl = (cents: number) => formatPriceRange({ minCents: cents, maxCents: cents });

const ROLE_NAMES = { CLIENT: 'Cliente', FREELANCER: 'Dev', ADMIN: 'Mediação' } as const;

/** Executa uma ação que devolve o contrato atualizado, com estado de envio e erro. */
function useContractAction(contractId: string) {
  const setContract = useSetContract(contractId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<Contract>): Promise<boolean> => {
    setError(null);
    setPending(true);
    try {
      setContract(await action());
      return true;
    } catch (actionError) {
      setError(errorMessage(actionError));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { run, pending, error, setError };
}

/** Prazos parados: por quê e o que acontece depois. */
export function PausedNotice({ contract }: { contract: Contract }) {
  if (!contract.paused) return null;
  const disputed = contract.status === 'DISPUTED';
  return (
    <Alert title="Prazos pausados">
      {disputed
        ? 'Enquanto a disputa não for decidida, nenhum prazo corre e o valor continua protegido em custódia.'
        : 'Há um pedido fora do escopo aguardando resposta. Quando ele for resolvido, os prazos voltam a correr, estendidos pelo tempo parado.'}
    </Alert>
  );
}

/** Pedidos fora do escopo aprovado (§4.4): marcar, aceitar e pagar, retirar ou contestar. */
export function OutOfScopeSection({ contract, viewer }: { contract: Contract; viewer: Viewer }) {
  const canFlag = viewer === 'freelancer' && contract.status === 'ACTIVE';
  if (contract.outOfScope.length === 0 && !canFlag) return null;
  return (
    <section aria-labelledby="oos-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="oos-title" className="text-h4 font-medium">
          Pedidos fora do escopo
        </h2>
        <p className="text-body text-muted">
          {viewer === 'client'
            ? 'Quando você pede algo que não estava no escopo aprovado, o dev pode propor um adicional. Você decide se aceita, retira ou contesta.'
            : 'Se o cliente pedir algo que não está no escopo aprovado, marque aqui com o valor e o prazo adicionais. Correções do que já foi combinado não entram aqui.'}
        </p>
      </div>
      {contract.outOfScope.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {[...contract.outOfScope].reverse().map((request) => (
            <li key={request.id}>
              <OutOfScopeCard contract={contract} request={request} viewer={viewer} />
            </li>
          ))}
        </ul>
      ) : null}
      {canFlag ? <FlagForm contract={contract} /> : null}
    </section>
  );
}

function OutOfScopeCard({
  contract,
  request,
  viewer,
}: {
  contract: Contract;
  request: OutOfScopeRequest;
  viewer: Viewer;
}) {
  const action = useContractAction(contract.id);
  const [contesting, setContesting] = useState(false);
  const [reason, setReason] = useState('');
  const path = { contractId: contract.id, requestId: request.id };
  const base = '/v1/contracts/{contractId}/out-of-scope/{requestId}' as const;

  const pay = async () => {
    action.setError(null);
    try {
      const { url } = await unwrap(api.POST(`${base}/checkout`, { params: { path } }));
      window.location.assign(url);
    } catch (payError) {
      action.setError(errorMessage(payError));
    }
  };

  const contest = async () => {
    const parsed = contestOutOfScopeSchema.safeParse({ reason });
    if (!parsed.success) {
      action.setError(parsed.error.issues[0]?.message ?? 'Explique a contestação.');
      return;
    }
    if (
      await action.run(() =>
        unwrap(api.POST(`${base}/contest`, { params: { path }, body: parsed.data })),
      )
    )
      setContesting(false);
  };

  const amount = viewer === 'client' ? request.clientTotalCents : request.freelancerNetCents;
  const closedWithoutCharge = request.status === 'WITHDRAWN' || request.status === 'RULED_IN_SCOPE';
  return (
    <Card tone="white" className="flex flex-col gap-4 border border-dark">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={request.status === 'ACCEPTED_FUNDED' ? 'accent' : 'neutral'}>
          {OUT_OF_SCOPE_STATUS_LABELS[request.status]}
        </Badge>
        <span className="text-sm text-muted">{dateTime.format(new Date(request.createdAt))}</span>
      </div>
      <p className="text-body whitespace-pre-line">{request.description}</p>
      <p className={closedWithoutCharge ? 'text-body text-muted' : 'text-body'}>
        <span className="font-medium">
          {closedWithoutCharge
            ? 'Adicional proposto (não cobrado): '
            : viewer === 'client'
              ? 'Adicional: '
              : 'Você recebe: '}
          {brl(amount)}
        </span>
        {request.extraDays > 0 ? ` · +${request.extraDays} dias de prazo` : ' · sem prazo extra'}
      </p>
      {request.contestReason ? (
        <Fact label="Contestação do cliente">{request.contestReason}</Fact>
      ) : null}
      {request.ruling ? (
        <Fact
          label={
            request.ruling.decision === 'IN_SCOPE'
              ? 'Mediação: estava no escopo (sem custo adicional)'
              : 'Mediação: está fora do escopo'
          }
        >
          {request.ruling.note}
        </Fact>
      ) : null}
      {action.error ? <Alert tone="error">{action.error}</Alert> : null}

      {viewer === 'client' && request.status === 'EXTRA_PROPOSED' ? (
        contesting ? (
          <div className="flex flex-col gap-3">
            <Field
              id={`contest-${request.id}`}
              label="Por que o pedido já estava no escopo?"
              hint="Cite o item do escopo aprovado. A mediação analisa o escopo e a conversa."
            >
              <Textarea
                {...fieldA11y(`contest-${request.id}`, undefined, true)}
                value={reason}
                maxLength={2000}
                onChange={(event) => setReason(event.target.value)}
                className="min-h-24"
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button disabled={action.pending} onClick={() => void contest()}>
                Enviar contestação
              </Button>
              <Button variant="outline" onClick={() => setContesting(false)}>
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={action.pending}
              onClick={() =>
                void action.run(() => unwrap(api.POST(`${base}/accept`, { params: { path } })))
              }
            >
              Aceitar adicional
            </Button>
            <Button
              variant="outline"
              disabled={action.pending}
              onClick={() =>
                void action.run(() => unwrap(api.POST(`${base}/withdraw`, { params: { path } })))
              }
            >
              Retirar o pedido
            </Button>
            <Button variant="outline" onClick={() => setContesting(true)}>
              Já estava no escopo
            </Button>
          </div>
        )
      ) : null}

      {viewer === 'client' && request.status === 'ACCEPTED_AWAITING_PAYMENT' ? (
        <div className="flex flex-col gap-3">
          <p className="text-body">
            Pague até {dateTime.format(new Date(request.paymentDeadlineAt!))}. O valor fica em
            custódia junto com o do contrato.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void pay()}>
              {request.paymentInProgress ? 'Continuar pagamento' : `Pagar ${brl(amount)}`}
            </Button>
            <Button
              variant="outline"
              disabled={action.pending}
              onClick={() =>
                void action.run(() => unwrap(api.POST(`${base}/withdraw`, { params: { path } })))
              }
            >
              Desistir do adicional
            </Button>
          </div>
        </div>
      ) : null}

      {viewer === 'freelancer' && request.status === 'EXTRA_PROPOSED' ? (
        <div>
          <Button
            variant="outline"
            disabled={action.pending}
            onClick={() =>
              void action.run(() => unwrap(api.POST(`${base}/withdraw`, { params: { path } })))
            }
          >
            Desistir de cobrar
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function FlagForm({ contract }: { contract: Contract }) {
  const action = useContractAction(contract.id);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('0');

  const submit = async () => {
    const parsed = outOfScopeInputSchema.safeParse({
      description,
      amountCents: Math.round(Number(amount.replace(',', '.')) * 100),
      extraDays: Number(days),
    });
    if (!parsed.success) {
      action.setError(parsed.error.issues[0]?.message ?? 'Confira os dados do pedido.');
      return;
    }
    const done = await action.run(() =>
      unwrap(
        api.POST('/v1/contracts/{contractId}/out-of-scope', {
          params: { path: { contractId: contract.id } },
          body: parsed.data,
        }),
      ),
    );
    if (done) {
      setOpen(false);
      setDescription('');
      setAmount('');
      setDays('0');
    }
  };

  if (!open)
    return (
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Marcar pedido fora do escopo
        </Button>
      </div>
    );
  return (
    <Card tone="surface" className="flex flex-col gap-4">
      <Field
        id="oos-description"
        label="O que o cliente pediu"
        hint="Explique por que não está no escopo aprovado."
      >
        <Textarea
          {...fieldA11y('oos-description', undefined, true)}
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="oos-amount"
          label="Valor adicional (R$)"
          hint="Comissão aplicada como no contrato."
        >
          <Input
            {...fieldA11y('oos-amount', undefined, true)}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="500,00"
          />
        </Field>
        <Field id="oos-days" label="Dias adicionais de prazo">
          <Input
            id="oos-days"
            type="number"
            min={0}
            max={180}
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
        </Field>
      </div>
      <p className="text-sm text-muted">
        Enquanto o cliente não responder, os prazos do contrato ficam pausados.
      </p>
      {action.error ? <Alert tone="error">{action.error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button disabled={action.pending} onClick={() => void submit()}>
          {action.pending ? 'Enviando…' : 'Enviar ao cliente'}
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}

/** Disputa (§4.5): abrir, enviar a versão, retirar; abandono pelo dev. */
export function DisputeSection({ contract, viewer }: { contract: Contract; viewer: Viewer }) {
  const dispute = contract.dispute;
  const showDispute = dispute && (dispute.status !== 'WITHDRAWN' || contract.status !== 'ACTIVE');
  if (showDispute) return <DisputeCard contract={contract} dispute={dispute} viewer={viewer} />;
  if (contract.status !== 'ACTIVE') return null;
  return <OpenDispute contract={contract} viewer={viewer} />;
}

function DisputeCard({
  contract,
  dispute,
  viewer,
}: {
  contract: Contract;
  dispute: Dispute;
  viewer: Viewer;
}) {
  const action = useContractAction(contract.id);
  const mine = viewer === 'client' ? 'CLIENT' : 'FREELANCER';
  const canWithdraw =
    dispute.status === 'OPEN' && dispute.kind === 'DISPUTE' && dispute.openedBy === mine;
  const r = dispute.resolution;
  return (
    <section aria-labelledby="dispute-title">
      <Card tone="white" className="flex flex-col gap-5 border border-dark">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="dark">{DISPUTE_STATUS_LABELS[dispute.status]}</Badge>
            <Badge>{DISPUTE_REASON_LABELS[dispute.reason]}</Badge>
          </div>
          <h2 id="dispute-title" className="text-h4 font-medium">
            {dispute.kind === 'ABANDONMENT' ? 'Abandono do projeto' : 'Disputa'}
          </h2>
          <p className="text-sm text-muted">
            Aberta por {ROLE_NAMES[dispute.openedBy].toLowerCase()} em{' '}
            {dateTime.format(new Date(dispute.createdAt))}
          </p>
        </div>
        <p className="text-body whitespace-pre-line">{dispute.description}</p>

        {r ? (
          <Card tone="accent" className="flex flex-col gap-2">
            <p className="font-medium">Decisão da mediação</p>
            <p className="text-body">
              {viewer === 'client'
                ? r.refundCents > 0
                  ? `Você recebe de volta ${brl(r.refundCents)}.`
                  : 'O valor foi reconhecido integralmente ao dev.'
                : r.freelancerCents > 0
                  ? `Você recebe ${brl(r.freelancerCents)} pelo trabalho realizado.`
                  : 'O valor em custódia foi devolvido ao cliente.'}
            </p>
            <p className="text-body whitespace-pre-line">{r.note}</p>
          </Card>
        ) : null}

        {dispute.statements.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="font-medium">Versões enviadas</h3>
            <ol className="flex flex-col gap-3">
              {dispute.statements.map((statement) => (
                <li
                  key={statement.createdAt}
                  className="flex flex-col gap-2 rounded-button bg-surface p-4"
                >
                  <span className="text-sm text-muted">
                    {statement.role === mine ? 'Você' : ROLE_NAMES[statement.role]} ·{' '}
                    {dateTime.format(new Date(statement.createdAt))}
                  </span>
                  <p className="text-body whitespace-pre-line">{statement.text}</p>
                  {statement.attachments.length > 0 ? (
                    <Attachments files={statement.attachments} />
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {dispute.status === 'OPEN' ? (
          <>
            <p className="text-body">
              Envie sua versão até {dateTime.format(new Date(dispute.evidenceDeadlineAt))}. Depois
              disso (ou quando as duas partes enviarem), a mediação analisa o escopo, as entregas e
              a conversa do contrato.
            </p>
            <StatementForm contract={contract} />
          </>
        ) : null}
        {dispute.status === 'UNDER_REVIEW' ? (
          <Alert>A mediação está analisando o caso. Vocês recebem a decisão por e-mail.</Alert>
        ) : null}
        {action.error ? <Alert tone="error">{action.error}</Alert> : null}
        {canWithdraw ? (
          <div>
            <Button
              variant="outline"
              disabled={action.pending}
              onClick={() =>
                void action.run(() =>
                  unwrap(
                    api.POST('/v1/contracts/{contractId}/dispute/withdraw', {
                      params: { path: { contractId: contract.id } },
                    }),
                  ),
                )
              }
            >
              Retirar a disputa
            </Button>
          </div>
        ) : null}
      </Card>
    </section>
  );
}

function StatementForm({ contract }: { contract: Contract }) {
  const action = useContractAction(contract.id);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<{ id: string; fileName: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])];
    event.target.value = '';
    action.setError(null);
    setUploading(true);
    try {
      for (const file of selected) {
        const uploaded = await uploadFile(file, 'DELIVERY_FILE');
        setFiles((current) => [...current, uploaded]);
      }
    } catch (uploadError) {
      action.setError(
        uploadError instanceof UploadRejectedError
          ? uploadError.message
          : errorMessage(uploadError),
      );
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const parsed = disputeStatementSchema.safeParse({
      text,
      attachmentIds: files.map((file) => file.id),
    });
    if (!parsed.success) {
      action.setError(parsed.error.issues[0]?.message ?? 'Escreva sua versão.');
      return;
    }
    const done = await action.run(() =>
      unwrap(
        api.POST('/v1/contracts/{contractId}/dispute/statements', {
          params: { path: { contractId: contract.id } },
          body: parsed.data,
        }),
      ),
    );
    if (done) {
      setText('');
      setFiles([]);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Field
        id="statement"
        label="Sua versão"
        hint="Conte o que aconteceu. Prints, vídeos e documentos ajudam a mediação."
      >
        <Textarea
          {...fieldA11y('statement', undefined, true)}
          value={text}
          maxLength={4000}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      {files.length > 0 ? (
        <ul className="flex flex-col gap-1 text-body">
          {files.map((file) => (
            <li key={file.id}>
              {file.fileName}{' '}
              <span className="text-sm text-muted">({formatFileSize(file.size)})</span>
            </li>
          ))}
        </ul>
      ) : null}
      {action.error ? <Alert tone="error">{action.error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-button border border-dark px-5 py-3 text-body hover:bg-surface">
          {uploading ? 'Enviando arquivo…' : 'Anexar arquivos'}
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={uploading}
            onChange={(event) => void onFiles(event)}
          />
        </label>
        <Button disabled={action.pending || uploading} onClick={() => void submit()}>
          {action.pending ? 'Enviando…' : 'Enviar minha versão'}
        </Button>
      </div>
    </div>
  );
}

function OpenDispute({ contract, viewer }: { contract: Contract; viewer: Viewer }) {
  const [mode, setMode] = useState<'closed' | 'dispute' | 'abandon'>('closed');
  if (mode === 'closed')
    return (
      <details className="rounded-card border border-dark/30 bg-bg p-6">
        <summary className="cursor-pointer text-body font-medium">
          Problemas com este contrato?
        </summary>
        <div className="mt-4 flex flex-col gap-3 text-body">
          <p>
            Tente primeiro resolver pela conversa do contrato. Se não houver acordo, abra uma
            disputa: os prazos param, o valor continua em custódia e a mediação decide quanto vai
            para cada lado.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setMode('dispute')}>
              Abrir disputa
            </Button>
            {viewer === 'freelancer' ? (
              <Button variant="outline" onClick={() => setMode('abandon')}>
                Não consigo concluir o projeto
              </Button>
            ) : null}
          </div>
        </div>
      </details>
    );
  return mode === 'dispute' ? (
    <DisputeForm contract={contract} onCancel={() => setMode('closed')} />
  ) : (
    <AbandonForm contract={contract} onCancel={() => setMode('closed')} />
  );
}

function DisputeForm({ contract, onCancel }: { contract: Contract; onCancel: () => void }) {
  const action = useContractAction(contract.id);
  const [reason, setReason] = useState('QUALITY');
  const [description, setDescription] = useState('');
  const submit = async () => {
    const parsed = openDisputeSchema.safeParse({ reason, description });
    if (!parsed.success) {
      action.setError(parsed.error.issues[0]?.message ?? 'Descreva o problema.');
      return;
    }
    await action.run(() =>
      unwrap(
        api.POST('/v1/contracts/{contractId}/disputes', {
          params: { path: { contractId: contract.id } },
          body: parsed.data,
        }),
      ),
    );
  };
  return (
    <Card tone="surface" className="flex flex-col gap-4">
      <h2 className="text-h4 font-medium">Abrir disputa</h2>
      <Field id="dispute-reason" label="Motivo">
        <select
          id="dispute-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-button border border-dark bg-bg px-5 py-4 text-body"
        >
          {(['QUALITY', 'DEADLINE', 'SCOPE', 'COMMUNICATION', 'OTHER'] as const).map((value) => (
            <option key={value} value={value}>
              {DISPUTE_REASON_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="dispute-description" label="O que aconteceu">
        <Textarea
          id="dispute-description"
          value={description}
          maxLength={4000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      {action.error ? <Alert tone="error">{action.error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button disabled={action.pending} onClick={() => void submit()}>
          {action.pending ? 'Abrindo…' : 'Abrir disputa'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}

function AbandonForm({ contract, onCancel }: { contract: Contract; onCancel: () => void }) {
  const action = useContractAction(contract.id);
  const [description, setDescription] = useState('');
  const submit = async () => {
    const parsed = abandonContractSchema.safeParse({ description });
    if (!parsed.success) {
      action.setError(parsed.error.issues[0]?.message ?? 'Explique o que aconteceu.');
      return;
    }
    await action.run(() =>
      unwrap(
        api.POST('/v1/contracts/{contractId}/abandon', {
          params: { path: { contractId: contract.id } },
          body: parsed.data,
        }),
      ),
    );
  };
  return (
    <Card tone="surface" className="flex flex-col gap-4">
      <h2 className="text-h4 font-medium">Desistir do projeto</h2>
      <Alert tone="error" title="Isso não pode ser desfeito">
        O cliente é avisado, a mediação decide quanto do valor fica com você pelo que já foi
        entregue, e você vai para o fim da fila de convites por um período.
      </Alert>
      <Field id="abandon-description" label="O que aconteceu">
        <Textarea
          id="abandon-description"
          value={description}
          maxLength={4000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      {action.error ? <Alert tone="error">{action.error}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button disabled={action.pending} onClick={() => void submit()}>
          {action.pending ? 'Enviando…' : 'Confirmar desistência'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Voltar
        </Button>
      </div>
    </Card>
  );
}

export function Attachments({ files }: { files: Dispute['statements'][number]['attachments'] }) {
  const [error, setError] = useState<string | null>(null);
  const download = async (fileId: string) => {
    setError(null);
    try {
      const { url } = await unwrap(
        api.GET('/v1/files/{fileId}/download', { params: { path: { fileId } } }),
      );
      window.location.assign(url);
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    }
  };
  return (
    <>
      <ul className="flex flex-col gap-1">
        {files.map((file) => (
          <li key={file.id} className="flex flex-wrap items-center gap-3 text-body">
            <span className="break-all">{file.fileName}</span>
            {file.status === 'READY' ? (
              <button
                type="button"
                className="text-sm underline"
                onClick={() => void download(file.id)}
              >
                Baixar
              </button>
            ) : (
              <Badge>{file.status === 'REJECTED' ? 'Recusado' : 'Em verificação'}</Badge>
            )}
          </li>
        ))}
      </ul>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-l-4 border-dark/20 pl-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-body whitespace-pre-line">{children}</p>
    </div>
  );
}
