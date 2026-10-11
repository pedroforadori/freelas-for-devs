import { BadRequestException, Controller, Inject } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  apiRoutes,
  type ContactViolation,
  type Conversation,
  type Message,
  type MessagePage,
} from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import {
  CurrentPrincipal,
  type Principal,
  RequestContext,
} from '../../../shared/interface/http/auth/principal.js';
import {
  type ContractRequest,
  ContractRoute,
  ValidRequest,
} from '../../../shared/interface/http/contract-route.js';
import {
  MESSAGING_DEPS,
  type ConversationRecord,
  type MessagingDeps,
} from '../application/ports.js';
import {
  Moderate,
  OpenConversation,
  ReadConversations,
  SendMessage,
} from '../application/use-cases.js';
import { SPECIALIST_DISPLAY_NAME, toMessageDto } from './presenters.js';

const routes = apiRoutes.messaging;
const MINUTE = 60_000;

/** Cursor opaco: posição (createdAt, id) da mensagem mais antiga já carregada. */
const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

const decodeCursor = (cursor: string | undefined): { createdAt: Date; id: string } | null => {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) throw new BadRequestException('Cursor inválido.');
  return { createdAt, id };
};

@Controller()
export class MessagingController {
  constructor(
    @Inject(MESSAGING_DEPS) private readonly deps: MessagingDeps,
    private readonly open: OpenConversation,
    private readonly read: ReadConversations,
    private readonly send: SendMessage,
  ) {}

  @ContractRoute(routes.listMyConversations)
  async list(@CurrentPrincipal() principal: Principal): Promise<{ items: Conversation[] }> {
    const items = await this.read.list(principal);
    return {
      items: await Promise.all(
        items.map(({ conversation, unread }) => this.present(conversation, unread)),
      ),
    };
  }

  @ContractRoute(routes.getProjectConversation)
  async forProject(
    @ValidRequest() { params }: ContractRequest<typeof routes.getProjectConversation>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Conversation> {
    const conversation = await this.open.forProject(principal, params.projectId);
    return this.present(conversation, await this.read.unread(principal, conversation.id));
  }

  @ContractRoute(routes.getContractConversation)
  async forContract(
    @ValidRequest() { params }: ContractRequest<typeof routes.getContractConversation>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Conversation> {
    const conversation = await this.open.forContract(principal, params.contractId);
    return this.present(conversation, await this.read.unread(principal, conversation.id));
  }

  @ContractRoute(routes.listMessages)
  async messages(
    @ValidRequest() { params, query }: ContractRequest<typeof routes.listMessages>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<MessagePage> {
    const { items, hasMore } = await this.read.page(
      principal,
      params.conversationId,
      decodeCursor(query.cursor),
      query.limit,
    );
    const names = await this.names(items.map((item) => item.senderId));
    const oldest = items.at(-1);
    return {
      items: items.map((item) => toMessageDto(item, names.get(item.senderId) ?? '')).reverse(),
      previousCursor: hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
    };
  }

  @ContractRoute(routes.sendMessage)
  @Throttle({ default: { limit: 30, ttl: MINUTE } })
  async sendMessage(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.sendMessage>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Message> {
    const message = await this.send.execute(principal, params.conversationId, body.body);
    const sender = await this.deps.people.find(principal.userId);
    return toMessageDto(message, sender?.displayName ?? '');
  }

  @ContractRoute(routes.markRead)
  async markRead(
    @ValidRequest() { params }: ContractRequest<typeof routes.markRead>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    await this.read.markRead(principal, params.conversationId);
  }

  private async names(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    const people = await Promise.all(unique.map((id) => this.deps.people.find(id)));
    return new Map(unique.map((id, index) => [id, people[index]?.displayName ?? '']));
  }

  private async present(conversation: ConversationRecord, unread: number): Promise<Conversation> {
    const project = await this.deps.projects.find(conversation.projectId);
    const names = await this.names(
      [conversation.clientId, conversation.freelancerId].filter((id): id is string => Boolean(id)),
    );
    return {
      id: conversation.id,
      kind: conversation.kind,
      project: { id: conversation.projectId, title: project?.title ?? '' },
      contractId: conversation.contractId,
      participants: [
        {
          userId: conversation.clientId,
          displayName: names.get(conversation.clientId) ?? '',
          role: 'CLIENT',
        },
        conversation.freelancerId
          ? {
              userId: conversation.freelancerId,
              displayName: names.get(conversation.freelancerId) ?? '',
              role: 'FREELANCER',
            }
          : // A equipe de especialistas responde como um todo; não expõe quem é o Admin.
            { userId: null, displayName: SPECIALIST_DISPLAY_NAME, role: 'SPECIALIST' },
      ],
      unreadCount: unread,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    };
  }
}

@Controller()
export class ModerationController {
  constructor(private readonly moderate: Moderate) {}

  @ContractRoute(routes.adminListViolations)
  async list(
    @ValidRequest() { query }: ContractRequest<typeof routes.adminListViolations>,
  ): Promise<{ items: ContactViolation[] }> {
    const items = await this.moderate.list(query.limit);
    return {
      items: items.map((item) => ({
        id: item.id,
        user: { userId: item.userId, ...item.user, recentViolations: item.recentViolations },
        source: item.source,
        kinds: item.kinds,
        maskedText: item.maskedText,
        projectId: item.projectId,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  @ContractRoute(routes.adminRevealViolation)
  async reveal(
    @ValidRequest() { params }: ContractRequest<typeof routes.adminRevealViolation>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<{ originalText: string }> {
    return {
      originalText: await this.moderate.reveal(principal.userId, params.violationId, meta),
    };
  }

  @ContractRoute(routes.adminSuspendUser)
  async suspend(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminSuspendUser>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<void> {
    await this.moderate.suspend(principal.userId, params.userId, body.reason, meta);
  }

  @ContractRoute(routes.adminReinstateUser)
  async reinstate(
    @ValidRequest() { params }: ContractRequest<typeof routes.adminReinstateUser>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<void> {
    await this.moderate.reinstate(principal.userId, params.userId, meta);
  }
}
