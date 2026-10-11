import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { defineRoute, noContent } from '../http/route.js';
import type { ContractStatus } from './contracts.js';
import type { ProjectStatus } from './projects.js';

/** Conversa de escopo (cliente ↔ especialista) ou de contrato (cliente ↔ freelancer). */
export const ConversationKind = { Scoping: 'SCOPING', Contract: 'CONTRACT' } as const;
export type ConversationKind = (typeof ConversationKind)[keyof typeof ConversationKind];
export const conversationKindSchema = z.enum(['SCOPING', 'CONTRACT']);

export const ParticipantRole = {
  Client: 'CLIENT',
  Freelancer: 'FREELANCER',
  Specialist: 'SPECIALIST',
} as const;
export type ParticipantRole = (typeof ParticipantRole)[keyof typeof ParticipantRole];
export const participantRoleSchema = z.enum(['CLIENT', 'FREELANCER', 'SPECIALIST']);

export const MESSAGE_LIMITS = { bodyMax: 4000 } as const;

/** Projeto em que a conversa de escopo aceita mensagens (até a distribuição terminar). */
export const SCOPING_CHAT_STATUSES: readonly ProjectStatus[] = [
  'ESTIMATING',
  'AWAITING_CLARIFICATION',
  'SCOPING',
  'READY_FOR_QUEUE',
  'NO_CANDIDATES',
  'DISTRIBUTING',
];

/** O chat do contrato abre com o pagamento em custódia (antes disso, nada de negociar por fora). */
export const CONTRACT_CHAT_STATUSES: readonly ContractStatus[] = ['ACTIVE', 'APPROVED', 'RELEASED'];

export const messageSchema = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    sender: z.object({
      userId: z.uuid(),
      displayName: z.string(),
      role: participantRoleSchema,
    }),
    /** Texto já mascarado: dados de contato viram "[contato removido]". */
    body: z.string(),
    /** O texto teve contato removido (o remetente vê o aviso). */
    masked: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Message' });

export const conversationSchema = z
  .object({
    id: z.uuid(),
    kind: conversationKindSchema,
    project: z.object({ id: z.uuid(), title: z.string() }),
    contractId: z.uuid().nullable(),
    participants: z.array(
      z.object({
        userId: z.uuid().nullable(),
        displayName: z.string(),
        role: participantRoleSchema,
      }),
    ),
    unreadCount: z.number().int(),
    lastMessageAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Conversation' });

export const messagePageSchema = z
  .object({
    /** Ordem cronológica (mais antigas primeiro) dentro da página. */
    items: z.array(messageSchema),
    /** Cursor para buscar mensagens anteriores. */
    previousCursor: z.string().nullable(),
  })
  .meta({ id: 'MessagePage' });

export const sendMessageRequestSchema = z
  .object({ body: z.string().trim().min(1, 'Escreva uma mensagem.').max(MESSAGE_LIMITS.bodyMax) })
  .strict()
  .meta({ id: 'SendMessageRequest' });

export const ViolationSource = { Chat: 'CHAT', Proposal: 'PROPOSAL' } as const;
export type ViolationSource = (typeof ViolationSource)[keyof typeof ViolationSource];

export const contactViolationSchema = z
  .object({
    id: z.uuid(),
    user: z.object({
      userId: z.uuid(),
      displayName: z.string(),
      email: z.string(),
      status: z.enum(['ACTIVE', 'SUSPENDED']),
      /** Infrações nos últimos 30 dias (inclui esta). */
      recentViolations: z.number().int(),
    }),
    source: z.enum(['CHAT', 'PROPOSAL']),
    kinds: z.array(z.enum(['PHONE', 'EMAIL', 'URL', 'HANDLE', 'MESSAGING_APP'])),
    /** Texto como ficou (mascarado). O original só via rota auditada. */
    maskedText: z.string(),
    projectId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ContactViolation' });

export type Message = z.infer<typeof messageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type MessagePage = z.infer<typeof messagePageSchema>;
export type ContactViolation = z.infer<typeof contactViolationSchema>;

/** Eventos do WebSocket (namespace /chat). */
export const ChatEvents = {
  /** Cliente → servidor: entrar na sala da conversa (ack `{ ok }`). */
  Join: 'conversation:join',
  /** Servidor → cliente: nova mensagem (payload `Message`). */
  MessageNew: 'message:new',
} as const;

const conversationParams = z.object({ conversationId: z.uuid() });
const moderate = { permission: Permission.AdminModeration } as const;

export const messagingRoutes = {
  listMyConversations: defineRoute({
    method: 'get',
    path: '/v1/conversations',
    operationId: 'listMyConversations',
    summary: 'Conversas do usuário com mensagens não lidas.',
    tags: ['messaging'],
    auth: 'authenticated',
    request: {},
    responses: { 200: z.object({ items: z.array(conversationSchema) }) },
  }),
  getProjectConversation: defineRoute({
    method: 'get',
    path: '/v1/projects/{projectId}/conversation',
    operationId: 'getProjectConversation',
    summary: 'Conversa de escopo do projeto (cliente ↔ especialista).',
    tags: ['messaging'],
    auth: 'authenticated',
    request: { params: z.object({ projectId: z.uuid() }) },
    responses: { 200: conversationSchema },
  }),
  getContractConversation: defineRoute({
    method: 'get',
    path: '/v1/contracts/{contractId}/conversation',
    operationId: 'getContractConversation',
    summary: 'Conversa do contrato (cliente ↔ freelancer; o Admin lê para moderação).',
    tags: ['messaging'],
    auth: 'authenticated',
    request: { params: z.object({ contractId: z.uuid() }) },
    responses: { 200: conversationSchema },
  }),
  listMessages: defineRoute({
    method: 'get',
    path: '/v1/conversations/{conversationId}/messages',
    operationId: 'listMessages',
    summary: 'Mensagens mais recentes; `cursor` busca as anteriores.',
    tags: ['messaging'],
    auth: 'authenticated',
    request: {
      params: conversationParams,
      query: z.object({
        cursor: z.string().max(512).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
    },
    responses: { 200: messagePageSchema },
  }),
  sendMessage: defineRoute({
    method: 'post',
    path: '/v1/conversations/{conversationId}/messages',
    operationId: 'sendMessage',
    summary: 'Envia mensagem (contato é mascarado antes de gravar e transmitir).',
    tags: ['messaging'],
    auth: 'authenticated',
    request: { params: conversationParams, body: sendMessageRequestSchema },
    responses: { 201: messageSchema },
  }),
  markRead: defineRoute({
    method: 'post',
    path: '/v1/conversations/{conversationId}/read',
    operationId: 'markConversationRead',
    summary: 'Marca a conversa como lida.',
    tags: ['messaging'],
    auth: 'authenticated',
    request: { params: conversationParams },
    responses: { 204: noContent },
  }),
  adminListViolations: defineRoute({
    method: 'get',
    path: '/v1/admin/moderation/violations',
    operationId: 'adminListViolations',
    summary: 'Tentativas de passar contato, mais recentes primeiro.',
    tags: ['admin', 'moderation'],
    auth: moderate,
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }) },
    responses: { 200: z.object({ items: z.array(contactViolationSchema) }) },
  }),
  adminRevealViolation: defineRoute({
    method: 'post',
    path: '/v1/admin/moderation/violations/{violationId}/reveal',
    operationId: 'adminRevealViolation',
    summary: 'Mostra o texto original (cifrado em repouso); o acesso é auditado.',
    tags: ['admin', 'moderation'],
    auth: moderate,
    request: { params: z.object({ violationId: z.uuid() }) },
    responses: { 200: z.object({ originalText: z.string() }) },
  }),
  adminSuspendUser: defineRoute({
    method: 'post',
    path: '/v1/admin/users/{userId}/suspend',
    operationId: 'adminSuspendUser',
    summary: 'Suspende a conta (sessões encerradas; sai da fila de convites).',
    tags: ['admin', 'moderation'],
    auth: moderate,
    request: {
      params: z.object({ userId: z.uuid() }),
      body: z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
    },
    responses: { 204: noContent },
  }),
  adminReinstateUser: defineRoute({
    method: 'post',
    path: '/v1/admin/users/{userId}/reinstate',
    operationId: 'adminReinstateUser',
    summary: 'Reativa uma conta suspensa.',
    tags: ['admin', 'moderation'],
    auth: moderate,
    request: { params: z.object({ userId: z.uuid() }) },
    responses: { 204: noContent },
  }),
} as const;
