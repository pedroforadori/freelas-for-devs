'use client';

import { unwrap } from '@f4d/api-client';
import {
  CONTRACT_CHAT_STATUSES,
  type Contract,
  CONTRACT_STATUS_LABELS,
  DELIVERY_LIMITS,
  DELIVERY_STAGE_LABELS,
  type Delivery,
  deliveryInputSchema,
  FILE_RULES,
} from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Badge } from '@f4d/ui/components/badge';
import { Button, buttonClasses } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Field, Input, Textarea } from '@f4d/ui/components/field';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type ChangeEvent, useState } from 'react';
import { useSession } from '@/features/auth/session';
import { dateTime, formatFileSize } from '@/features/projects/format';
import { api } from '@/lib/api';
import { compact } from '@/lib/compact';
import { errorMessage } from '@/lib/problem';
import { UploadRejectedError, uploadFile } from '@/lib/upload';
import { ChatPanel } from '@/features/messaging/chat-panel';
import { AmountsTable } from './contract-cards';
import { DisputeSection, OutOfScopeSection, PausedNotice } from './issues';
import { contractKey, useSetContract } from './queries';

const OUTCOME_LABELS: Record<NonNullable<Delivery['outcome']>, string> = {
  ADJUSTMENTS: 'Ajustes pedidos',
  APPROVED: 'Aprovada',
  AUTO_APPROVED: 'Aprovada automaticamente (prazo de revisão)',
  TIMEOUT: 'Sem revisão no prazo — seguiu sem ajustes',
  CORRECTION: 'Correção pontual pedida',
};

const deliveryName = (number: number) => (number === 3 ? 'Entrega final' : `${number}ª entrega`);

/** Área do contrato: entregas, revisões, aprovação, repasse e avaliação (cliente e freelancer). */
export function ContractWorkspace({ contractId }: { contractId: string }) {
  const { me } = useSession();
  const query = useQuery({
    queryKey: contractKey(contractId),
    queryFn: () =>
      unwrap(api.GET('/v1/contracts/{contractId}', { params: { path: { contractId } } })),
    // Voltando do checkout de um adicional: acompanha até o pagamento ser confirmado.
    refetchInterval: (q) =>
      q.state.data?.outOfScope.some(
        (request) => request.status === 'ACCEPTED_AWAITING_PAYMENT' && request.paymentInProgress,
      )
        ? 4_000
        : false,
  });
  if (query.isPending) return <p role="status">Carregando…</p>;
  if (query.isError) return <Alert tone="error">{errorMessage(query.error)}</Alert>;
  const contract = query.data;
  const viewer = me?.id === contract.client.userId ? 'client' : 'freelancer';
  const work = contract.work;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="dark">{CONTRACT_STATUS_LABELS[contract.status]}</Badge>
          {work?.stage && contract.status === 'ACTIVE' ? (
            <Badge tone="accent">{DELIVERY_STAGE_LABELS[work.stage]}</Badge>
          ) : null}
        </div>
        <h1 className="text-h3 font-medium md:text-h2">{contract.project.title}</h1>
        <p className="text-body text-muted">
          {viewer === 'client'
            ? `Dev: ${contract.freelancer.displayName}`
            : `Cliente: ${contract.client.displayName}`}
          {work ? ` · prazo combinado até ${dateTime.format(new Date(work.dueAt))}` : ''}
        </p>
      </div>

      <PausedNotice contract={contract} />
      <DisputeSection contract={contract} viewer={viewer} />
      <NextStep contract={contract} viewer={viewer} />
      <OutOfScopeSection contract={contract} viewer={viewer} />

      {CONTRACT_CHAT_STATUSES.includes(contract.status) ? (
        <ChatPanel
          source={{ kind: 'contract', contractId: contract.id }}
          title="Conversa do contrato"
          description={
            viewer === 'client'
              ? `Fale com ${contract.freelancer.displayName} sobre o andamento. A equipe acompanha em caso de disputa.`
              : `Fale com ${contract.client.displayName} sobre o andamento. A equipe acompanha em caso de disputa.`
          }
        />
      ) : null}

      {work && work.deliveries.length > 0 ? (
        <section aria-labelledby="deliveries-title" className="flex flex-col gap-4">
          <h2 id="deliveries-title" className="text-h4 font-medium">
            Entregas
          </h2>
          <ol className="flex flex-col gap-4">
            {[...work.deliveries].reverse().map((delivery) => (
              <li key={`${delivery.number}-${delivery.submittedAt}`}>
                <DeliveryCard delivery={delivery} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Card tone="white" className="flex flex-col gap-4">
        <h2 className="text-h4 font-medium">Valores</h2>
        <AmountsTable contract={contract} viewer={viewer} />
      </Card>
    </>
  );
}

/** O que cada lado precisa fazer agora. */
function NextStep({ contract, viewer }: { contract: Contract; viewer: 'client' | 'freelancer' }) {
  const work = contract.work;
  if (contract.status === 'APPROVED' || contract.status === 'RELEASED') {
    return <Completed contract={contract} viewer={viewer} />;
  }
  // Em disputa, o cartão da disputa é o próximo passo; encerrado pela mediação, ele mostra a decisão.
  if (contract.status === 'DISPUTED' || contract.status === 'SETTLED') return null;
  if (!work?.stage) {
    return (
      <Alert>
        {contract.status === 'AWAITING_PAYMENT'
          ? 'Aguardando o pagamento do cliente.'
          : 'Este contrato foi encerrado.'}
      </Alert>
    );
  }
  const reviewing = work.stage.startsWith('REVIEW') || work.stage === 'FINAL_REVIEW';
  if (viewer === 'freelancer') {
    return reviewing ? (
      <Alert title="Entrega enviada">
        O cliente tem até {dateTime.format(new Date(work.reviewDeadlineAt!))} para revisar.
        {work.stage === 'FINAL_REVIEW'
          ? ' Sem resposta, a entrega final é aprovada automaticamente.'
          : ' Sem resposta, você segue para a próxima etapa sem ajustes.'}
      </Alert>
    ) : (
      <DeliveryForm contract={contract} />
    );
  }
  return reviewing ? (
    <ReviewForm contract={contract} />
  ) : (
    <Alert title={DELIVERY_STAGE_LABELS[work.stage]}>
      Você recebe um e-mail quando a próxima entrega chegar.
    </Alert>
  );
}

function DeliveryCard({ delivery }: { delivery: Delivery }) {
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
    <article className="flex flex-col gap-3 rounded-[24px] border border-dark bg-bg p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{deliveryName(delivery.number)}</h3>
        <span className="text-sm text-muted">
          {dateTime.format(new Date(delivery.submittedAt))}
        </span>
      </div>
      <p className="text-body whitespace-pre-line">{delivery.message}</p>
      {delivery.links.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {delivery.links.map((link) => (
            <li key={link} className="break-all">
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline"
              >
                {link}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {delivery.attachments.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {delivery.attachments.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3">
              <span>
                {file.fileName}{' '}
                <span className="text-sm text-muted">({formatFileSize(file.size)})</span>
              </span>
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
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {delivery.outcome ? (
        <div className="flex flex-col gap-2 border-t border-dark/20 pt-3">
          <Badge
            tone={delivery.outcome.includes('APPROVED') ? 'accent' : 'neutral'}
            className="self-start"
          >
            {OUTCOME_LABELS[delivery.outcome]}
          </Badge>
          {delivery.adjustments.length > 0 ? (
            <ul className="list-disc pl-6 text-body">
              {delivery.adjustments.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ul>
          ) : null}
          {delivery.correction?.note ? (
            <p className="text-body">“{delivery.correction.note}”</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** Freelancer: entrega da etapa atual, com os ajustes pendentes à vista. */
function DeliveryForm({ contract }: { contract: Contract }) {
  const setContract = useSetContract(contract.id);
  const work = contract.work!;
  const [message, setMessage] = useState('');
  const [linksText, setLinksText] = useState('');
  const [files, setFiles] = useState<{ id: string; fileName: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = work.deliveries.at(-1);
  const pendingAdjustments =
    last?.outcome === 'CORRECTION'
      ? work.deliveries
          .flatMap((delivery) => delivery.adjustments)
          .filter((item) => last.correction?.adjustmentIds.includes(item.id))
      : (last?.adjustments ?? []);
  const number = work.stage === 'WORKING_FINAL' ? 3 : work.stage === 'WORKING_D2' ? 2 : 1;

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])];
    event.target.value = '';
    setError(null);
    setUploading(true);
    try {
      for (const file of selected) {
        const uploaded = await uploadFile(file, 'DELIVERY_FILE');
        setFiles((current) => [
          ...current,
          { id: uploaded.id, fileName: uploaded.fileName, size: uploaded.size },
        ]);
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof UploadRejectedError
          ? uploadError.message
          : errorMessage(uploadError),
      );
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const parsed = deliveryInputSchema.safeParse({
      message,
      links: linksText.split(/\s+/).filter(Boolean),
      attachmentIds: files.map((file) => file.id),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os dados da entrega.');
      return;
    }
    setError(null);
    setPending(true);
    try {
      setContract(
        await unwrap(
          api.POST('/v1/contracts/{contractId}/deliveries', {
            params: { path: { contractId: contract.id } },
            body: compact(parsed.data),
          }),
        ),
      );
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card tone="accent" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-h4 font-medium">Enviar {deliveryName(number).toLowerCase()}</h2>
        <p className="text-body">
          {number === 1
            ? 'A 1ª entrega deve ser completa: o cliente responde com uma lista única de ajustes.'
            : number === 2
              ? 'Aplique os ajustes pedidos. Depois desta, ainda há a entrega final.'
              : 'Entrega final: depois dela, o cliente aprova (ou ela é aprovada automaticamente no prazo).'}
        </p>
      </div>
      {pendingAdjustments.length > 0 ? (
        <div className="rounded-[20px] border border-dark bg-bg p-4">
          <p className="font-medium">Ajustes pedidos pelo cliente</p>
          <ul className="list-disc pl-6 text-body">
            {pendingAdjustments.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
          {last?.correction?.note ? (
            <p className="mt-2 text-body">“{last.correction.note}”</p>
          ) : null}
        </div>
      ) : null}
      <Field
        id="delivery-message"
        label="O que você está entregando"
        hint="Como acessar, o que mudou, como testar."
      >
        <Textarea
          id="delivery-message"
          rows={5}
          maxLength={DELIVERY_LIMITS.messageMax}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </Field>
      <Field
        id="delivery-links"
        label="Links (opcional)"
        hint="Um por linha: site de teste, repositório, protótipo."
      >
        <Textarea
          id="delivery-links"
          rows={2}
          className="min-h-0"
          value={linksText}
          onChange={(event) => setLinksText(event.target.value)}
        />
      </Field>
      <div className="flex flex-col gap-2">
        {files.map((file) => (
          <p key={file.id} className="text-body">
            {file.fileName}{' '}
            <span className="text-sm text-muted">({formatFileSize(file.size)})</span>
          </p>
        ))}
        <label className={buttonClasses('outline', 'h-12 cursor-pointer self-start px-6')}>
          {uploading ? 'Enviando arquivo…' : 'Anexar arquivos'}
          <input
            type="file"
            multiple
            accept={FILE_RULES.DELIVERY_FILE.contentTypes.join(',')}
            className="sr-only"
            disabled={uploading}
            onChange={(event) => void onFiles(event)}
          />
        </label>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button className="self-start" disabled={pending || uploading} onClick={() => void submit()}>
        {pending ? 'Enviando…' : 'Enviar entrega'}
      </Button>
    </Card>
  );
}

/** Cliente: aprovar, lista única de ajustes (1ª e 2ª) ou correção pontual (final). */
function ReviewForm({ contract }: { contract: Contract }) {
  const setContract = useSetContract(contract.id);
  const work = contract.work!;
  const final = work.stage === 'FINAL_REVIEW';
  const previousAdjustments = work.deliveries.flatMap((delivery) => delivery.adjustments);
  const [itemsText, setItemsText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const send = async (body: Parameters<typeof reviewRequest>[1], confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    setPending(true);
    try {
      setContract(await reviewRequest(contract.id, body));
    } catch (sendError) {
      setError(errorMessage(sendError));
    } finally {
      setPending(false);
    }
  };

  const items = itemsText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <Card tone="accent" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-h4 font-medium">
          {final ? 'Revise a entrega final' : `Revise a ${work.deliveries.length}ª entrega`}
        </h2>
        <p className="text-body">
          Prazo: {dateTime.format(new Date(work.reviewDeadlineAt!))}.{' '}
          {final
            ? 'Sem resposta até lá, ela é aprovada automaticamente e o pagamento liberado ao dev.'
            : 'Sem resposta até lá, o projeto segue para a próxima entrega sem ajustes.'}
        </p>
      </div>
      <Button
        className="self-start"
        disabled={pending}
        onClick={() =>
          void send(
            { decision: 'APPROVE' },
            final
              ? 'Aprovar a entrega final? O pagamento em custódia é liberado ao dev.'
              : 'Aprovar já, sem as próximas entregas? O pagamento em custódia é liberado ao dev.',
          )
        }
      >
        {final ? 'Aprovar e liberar pagamento' : 'Aprovar antecipadamente'}
      </Button>

      {!final ? (
        <div className="flex flex-col gap-3 border-t border-dark/20 pt-4">
          <Field
            id="adjustments"
            label="Lista de ajustes (uma única lista por entrega)"
            hint="Um ajuste por linha. Pedidos fora do escopo aprovado não entram aqui."
          >
            <Textarea
              id="adjustments"
              rows={5}
              value={itemsText}
              onChange={(event) => setItemsText(event.target.value)}
            />
          </Field>
          <Button
            variant="outline"
            className="h-12 self-start px-6"
            disabled={pending || items.length === 0}
            onClick={() => void send({ decision: 'ADJUSTMENTS', items })}
          >
            Enviar {items.length > 0 ? `${items.length} ajuste(s)` : 'ajustes'}
          </Button>
        </div>
      ) : work.correctionsLeft > 0 && previousAdjustments.length > 0 ? (
        <fieldset className="flex flex-col gap-3 border-t border-dark/20 pt-4">
          <legend className="font-medium">Algum ajuste já pedido não ficou certo?</legend>
          {previousAdjustments.map((item) => (
            <label key={item.id} className="flex items-start gap-3 text-body">
              <input
                type="checkbox"
                className="mt-1 size-5 accent-dark"
                checked={selected.includes(item.id)}
                onChange={() =>
                  setSelected((current) =>
                    current.includes(item.id)
                      ? current.filter((id) => id !== item.id)
                      : [...current, item.id],
                  )
                }
              />
              {item.text}
            </label>
          ))}
          <Input
            aria-label="O que ainda falta"
            placeholder="O que ainda falta (opcional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            variant="outline"
            className="h-12 self-start px-6"
            disabled={pending || selected.length === 0}
            onClick={() =>
              void send({
                decision: 'CORRECTION',
                adjustmentIds: selected,
                ...(note.trim() ? { note } : {}),
              })
            }
          >
            Pedir correção pontual
          </Button>
        </fieldset>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </Card>
  );
}

const reviewRequest = (
  contractId: string,
  body:
    | { decision: 'APPROVE' }
    | { decision: 'ADJUSTMENTS'; items: string[] }
    | { decision: 'CORRECTION'; adjustmentIds: string[]; note?: string },
) =>
  unwrap(api.POST('/v1/contracts/{contractId}/review', { params: { path: { contractId } }, body }));

/** Depois da aprovação: repasse e avaliação. */
function Completed({ contract, viewer }: { contract: Contract; viewer: 'client' | 'freelancer' }) {
  const work = contract.work!;
  const released = contract.status === 'RELEASED';
  return (
    <Card tone="accent" className="flex flex-col gap-4">
      <h2 className="text-h4 font-medium">
        {work.approvedAutomatically ? 'Entrega aprovada automaticamente' : 'Entrega aprovada'}
      </h2>
      <p className="text-body">
        {viewer === 'client'
          ? released
            ? 'O pagamento foi liberado ao dev. Obrigado por usar a Freelas 4 Devs!'
            : 'O pagamento está sendo liberado ao dev.'
          : released
            ? `Pagamento repassado em ${dateTime.format(new Date(work.releasedAt!))}.`
            : 'O repasse sai assim que sua conta de recebimento estiver pronta.'}
      </p>
      {viewer === 'freelancer' && !released ? (
        <Link
          href="/conta/recebimentos"
          className={buttonClasses('outline', 'h-12 self-start px-6')}
        >
          Ver conta de recebimento
        </Link>
      ) : null}
      {viewer === 'client' ? <RatingForm contract={contract} /> : null}
      {viewer === 'freelancer' && work.rating ? (
        <p className="text-body">
          Avaliação do cliente: {'★'.repeat(work.rating.rating)}
          {'☆'.repeat(5 - work.rating.rating)}
          {work.rating.comment ? ` — “${work.rating.comment}”` : ''}
        </p>
      ) : null}
    </Card>
  );
}

function RatingForm({ contract }: { contract: Contract }) {
  const setContract = useSetContract(contract.id);
  const existing = contract.work?.rating;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (existing) {
    return (
      <p className="text-body">
        Sua avaliação: {'★'.repeat(existing.rating)}
        {'☆'.repeat(5 - existing.rating)}
      </p>
    );
  }
  const submit = async () => {
    setError(null);
    setPending(true);
    try {
      setContract(
        await unwrap(
          api.POST('/v1/contracts/{contractId}/rating', {
            params: { path: { contractId: contract.id } },
            body: { rating, ...(comment.trim() ? { comment } : {}) },
          }),
        ),
      );
    } catch (rateError) {
      setError(errorMessage(rateError));
    } finally {
      setPending(false);
    }
  };
  return (
    <fieldset className="flex flex-col gap-3 border-t border-dark/20 pt-4">
      <legend className="font-medium">
        Como foi trabalhar com {contract.freelancer.displayName}?
      </legend>
      <div className="flex gap-1" role="radiogroup" aria-label="Nota de 1 a 5">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} estrela${value > 1 ? 's' : ''}`}
            className="text-h3 leading-none"
            onClick={() => setRating(value)}
          >
            {value <= rating ? '★' : '☆'}
          </button>
        ))}
      </div>
      <Input
        aria-label="Comentário"
        placeholder="Comentário (opcional)"
        maxLength={1000}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        variant="outline"
        className="h-12 self-start px-6"
        disabled={pending || rating === 0}
        onClick={() => void submit()}
      >
        Enviar avaliação
      </Button>
    </fieldset>
  );
}
