'use client';

import { unwrap } from '@f4d/api-client';
import { ChatEvents, type Conversation, type Message, type MessagePage } from '@f4d/contracts';
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { chatSocket } from '@/lib/socket';

export type ConversationSource =
  { kind: 'project'; projectId: string } | { kind: 'contract'; contractId: string };

const conversationKey = (source: ConversationSource) =>
  source.kind === 'project'
    ? (['conversations', 'project', source.projectId] as const)
    : (['conversations', 'contract', source.contractId] as const);

export const messagesKey = (conversationId: string) =>
  ['conversations', conversationId, 'messages'] as const;

export const useConversation = (source: ConversationSource) =>
  useQuery({
    queryKey: conversationKey(source),
    queryFn: (): Promise<Conversation> =>
      source.kind === 'project'
        ? unwrap(
            api.GET('/v1/projects/{projectId}/conversation', {
              params: { path: { projectId: source.projectId } },
            }),
          )
        : unwrap(
            api.GET('/v1/contracts/{contractId}/conversation', {
              params: { path: { contractId: source.contractId } },
            }),
          ),
  });

type Pages = InfiniteData<MessagePage, string | null>;

/** Acrescenta a mensagem à página mais recente (ignora repetidas: HTTP e socket entregam a mesma). */
const appendMessage = (data: Pages | undefined, message: Message): Pages | undefined => {
  if (!data) return data;
  if (data.pages.some((page) => page.items.some((item) => item.id === message.id))) return data;
  const [latest, ...older] = data.pages;
  return {
    ...data,
    pages: [{ ...latest!, items: [...latest!.items, message] }, ...older],
  };
};

/**
 * Mensagens da conversa: a primeira página traz as mais recentes; `fetchNextPage` busca as
 * anteriores. Em tempo real via socket; sem conexão, consulta a cada 10 s.
 */
export const useMessages = (conversationId: string) => {
  const queryClient = useQueryClient();
  const live = useLiveConversation(conversationId);
  const query = useInfiniteQuery({
    queryKey: messagesKey(conversationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/conversations/{conversationId}/messages', {
          params: {
            path: { conversationId },
            query: { limit: 30, ...(pageParam ? { cursor: pageParam } : {}) },
          },
        }),
      ),
    getNextPageParam: (page) => page.previousCursor,
    refetchInterval: live ? false : 10_000,
  });

  useEffect(() => {
    const socket = chatSocket();
    const onMessage = (message: Message) => {
      if (message.conversationId !== conversationId) return;
      queryClient.setQueryData<Pages>(messagesKey(conversationId), (data) =>
        appendMessage(data, message),
      );
    };
    socket.on(ChatEvents.MessageNew, onMessage);
    return () => {
      socket.off(ChatEvents.MessageNew, onMessage);
    };
  }, [conversationId, queryClient]);

  /** Do mais antigo para o mais recente. */
  const messages = [...(query.data?.pages ?? [])].reverse().flatMap((page) => page.items);
  return { ...query, messages, live };
};

/** Entra na sala da conversa (e de novo a cada reconexão). Devolve se está ao vivo. */
const useLiveConversation = (conversationId: string): boolean => {
  const [live, setLive] = useState(false);
  useEffect(() => {
    const socket = chatSocket();
    const join = () => {
      socket
        .timeout(5_000)
        .emitWithAck(ChatEvents.Join, { conversationId })
        .then((ack: { ok: boolean }) => setLive(ack.ok))
        .catch(() => setLive(false));
    };
    const down = () => setLive(false);
    if (socket.connected) join();
    socket.on('connect', join);
    socket.on('disconnect', down);
    socket.on('connect_error', down);
    return () => {
      socket.off('connect', join);
      socket.off('disconnect', down);
      socket.off('connect_error', down);
    };
  }, [conversationId]);
  return live;
};

export const useSendMessage = (conversationId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      unwrap(
        api.POST('/v1/conversations/{conversationId}/messages', {
          params: { path: { conversationId } },
          body: { body },
        }),
      ),
    onSuccess: (message) => {
      queryClient.setQueryData<Pages>(messagesKey(conversationId), (data) =>
        appendMessage(data, message),
      );
    },
  });
};

export const markConversationRead = (conversationId: string) =>
  unwrap(
    api.POST('/v1/conversations/{conversationId}/read', { params: { path: { conversationId } } }),
  ).catch(() => undefined);
