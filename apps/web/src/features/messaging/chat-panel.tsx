'use client';

import { type Message, MESSAGE_LIMITS, type ParticipantRole } from '@f4d/contracts';
import { Alert } from '@f4d/ui/components/alert';
import { Button } from '@f4d/ui/components/button';
import { Card } from '@f4d/ui/components/card';
import { Textarea } from '@f4d/ui/components/field';
import { cn } from '@f4d/ui/cn';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useSession } from '@/features/auth/session';
import { dateTime } from '@/features/projects/format';
import { errorMessage } from '@/lib/problem';
import {
  type ConversationSource,
  markConversationRead,
  useConversation,
  useMessages,
  useSendMessage,
} from './queries';

const ROLE_LABELS: Record<ParticipantRole, string> = {
  CLIENT: 'Cliente',
  FREELANCER: 'Dev',
  SPECIALIST: 'Especialista',
};

export interface ChatPanelProps {
  source: ConversationSource;
  title: string;
  description: string;
}

/** Conversa da plataforma: escopo (cliente ↔ especialista) ou contrato (cliente ↔ dev). */
export function ChatPanel({ source, title, description }: ChatPanelProps) {
  const conversation = useConversation(source);
  return (
    <Card tone="white" className="flex flex-col gap-4 border border-dark">
      <div className="flex flex-col gap-1">
        <h2 className="text-h4 font-medium">{title}</h2>
        <p className="text-body text-muted">{description}</p>
      </div>
      {conversation.isPending ? <p role="status">Carregando conversa…</p> : null}
      {conversation.isError ? <Alert tone="error">{errorMessage(conversation.error)}</Alert> : null}
      {conversation.data ? <Thread conversationId={conversation.data.id} /> : null}
    </Card>
  );
}

function Thread({ conversationId }: { conversationId: string }) {
  const { me } = useSession();
  const thread = useMessages(conversationId);
  const listRef = useRef<HTMLOListElement>(null);
  const lastId = thread.messages.at(-1)?.id;

  // Nova mensagem: rola para o fim e marca como lida.
  useEffect(() => {
    if (!lastId) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    void markConversationRead(conversationId);
  }, [conversationId, lastId]);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
        <span
          aria-hidden="true"
          className={cn('size-2 rounded-full', thread.live ? 'bg-green-600' : 'bg-dark/30')}
        />
        {thread.live ? 'Ao vivo' : 'Atualizando a cada 10 segundos'}
      </p>
      {thread.isError ? <Alert tone="error">{errorMessage(thread.error)}</Alert> : null}
      <ol
        ref={listRef}
        aria-label="Mensagens"
        className="flex max-h-[28rem] min-h-40 flex-col gap-3 overflow-y-auto rounded-button bg-surface p-4"
      >
        {thread.hasNextPage ? (
          <li className="self-center">
            <Button
              variant="outline"
              className="px-4 py-1.5 text-sm"
              disabled={thread.isFetchingNextPage}
              onClick={() => void thread.fetchNextPage()}
            >
              {thread.isFetchingNextPage ? 'Carregando…' : 'Mensagens anteriores'}
            </Button>
          </li>
        ) : null}
        {thread.isPending ? <li role="status">Carregando mensagens…</li> : null}
        {!thread.isPending && thread.messages.length === 0 ? (
          <li className="m-auto text-center text-body text-muted">
            Nenhuma mensagem ainda. Escreva a primeira!
          </li>
        ) : null}
        {thread.messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            own={message.sender.userId === me?.id}
          />
        ))}
      </ol>
      <Composer conversationId={conversationId} />
    </div>
  );
}

/** Nome e papel, sem repetir quando o nome já diz o papel (ex.: a equipe de especialistas). */
const senderLabel = ({ sender }: Message) => {
  const role = ROLE_LABELS[sender.role];
  return sender.displayName.startsWith(role)
    ? sender.displayName
    : `${sender.displayName} · ${role}`;
};

function MessageBubble({ message, own }: { message: Message; own: boolean }) {
  return (
    <li
      className={cn(
        'flex min-w-0 max-w-[85%] flex-col gap-1',
        own ? 'items-end self-end' : 'self-start',
      )}
    >
      <span className="text-xs text-muted">
        {own ? 'Você' : senderLabel(message)} · {dateTime.format(new Date(message.createdAt))}
      </span>
      <p
        className={cn(
          'max-w-full rounded-button px-4 py-2 text-body whitespace-pre-line [overflow-wrap:anywhere]',
          own ? 'bg-dark text-white' : 'border border-dark/20 bg-bg',
        )}
      >
        {message.body}
      </p>
      {message.masked ? (
        <span className="text-xs text-muted">Dados de contato removidos pela moderação.</span>
      ) : null}
    </li>
  );
}

function Composer({ conversationId }: { conversationId: string }) {
  const [body, setBody] = useState('');
  const [maskedNotice, setMaskedNotice] = useState(false);
  const send = useSendMessage(conversationId);
  const id = `chat-${conversationId}`;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = body.trim();
    if (!text || send.isPending) return;
    send.mutate(text, {
      onSuccess: (message) => {
        setBody('');
        setMaskedNotice(message.masked);
      },
    });
  };

  // Enter envia; Shift+Enter quebra a linha.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {maskedNotice ? (
        <Alert tone="info" title="Removemos dados de contato da sua mensagem">
          Telefone, e-mail, redes e links pessoais não podem ser compartilhados: combinar por fora
          tira a proteção da custódia e da mediação. Tentativas repetidas levam a advertência e
          suspensão.
        </Alert>
      ) : null}
      {send.isError ? <Alert tone="error">{errorMessage(send.error)}</Alert> : null}
      <label htmlFor={id} className="sr-only">
        Mensagem
      </label>
      <Textarea
        id={id}
        value={body}
        maxLength={MESSAGE_LIMITS.bodyMax}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Escreva sua mensagem…"
        className="min-h-20"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Links do GitHub, GitLab, Figma, Vercel, Netlify e Loom são permitidos.
        </p>
        <Button type="submit" disabled={!body.trim() || send.isPending}>
          {send.isPending ? 'Enviando…' : 'Enviar'}
        </Button>
      </div>
    </form>
  );
}
