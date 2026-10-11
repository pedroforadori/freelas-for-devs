import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ChatEvents, type Message } from '@f4d/contracts';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { ENV } from '../../../shared/config/config.module.js';
import type { Env } from '../../../shared/config/env.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
} from '../../../shared/interface/http/auth/auth.guard.js';
import {
  AUTH_COOKIES,
  type AuthCookies,
} from '../../../shared/interface/http/auth/auth-cookies.js';
import type { MessageRecord, RealtimePublisher } from '../application/ports.js';
import { ReadConversations, type Requester } from '../application/use-cases.js';
import { toMessageDto } from './presenters.js';

const joinSchema = z.object({ conversationId: z.uuid() });

const parseCookies = (header: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair): pair is [string, string] => pair.length >= 2 && Boolean(pair[0]))
      .map(([name, ...rest]) => [name, decodeURIComponent(rest.join('='))]),
  );

const room = (conversationId: string) => `conversation:${conversationId}`;

/**
 * Emite mensagens já gravadas para a sala da conversa. Separado do gateway para não criar ciclo
 * de injeção (o gateway depende dos casos de uso, que dependem deste publicador).
 */
@Injectable()
export class ChatBroadcaster implements RealtimePublisher {
  private readonly logger = new Logger('ChatBroadcaster');
  private namespace: Namespace | undefined;

  attach(namespace: Namespace): void {
    this.namespace = namespace;
  }

  publish(conversationId: string, message: MessageRecord & { senderName: string }): void {
    if (!this.namespace) return;
    try {
      const dto: Message = toMessageDto(message, message.senderName);
      this.namespace.to(room(conversationId)).emit(ChatEvents.MessageNew, dto);
    } catch (error) {
      // Tempo real é melhor esforço: a mensagem já está gravada e aparece no próximo carregamento.
      this.logger.warn({ err: String(error), conversationId }, 'Falha ao transmitir mensagem');
    }
  }
}

/**
 * Chat em tempo real (namespace /chat). Autentica no handshake pelo mesmo cookie de sessão do HTTP
 * (ou Bearer para o app mobile) e confere a origem; cada `conversation:join` verifica participação.
 * O servidor só emite mensagens já gravadas — o envio continua sendo pelo HTTP.
 */
@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer() private readonly namespace!: Namespace;
  /** Quem é cada socket, resolvido uma única vez no handshake. */
  private readonly requesters = new WeakMap<Socket, Requester>();

  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    @Inject(AUTH_COOKIES) private readonly cookies: AuthCookies,
    @Inject(ENV) private readonly env: Env,
    private readonly conversations: ReadConversations,
    private readonly broadcaster: ChatBroadcaster,
  ) {}

  afterInit(): void {
    this.broadcaster.attach(this.namespace);
    // Middleware do handshake: recusa antes do `connect` chegar ao cliente (sem corrida com o join).
    this.namespace.use((socket, next) => {
      this.authenticate(socket).then(
        (requester) => {
          this.requesters.set(socket, requester);
          next();
        },
        () => next(new Error('UNAUTHENTICATED')),
      );
    });
  }

  private async authenticate(socket: Socket): Promise<Requester> {
    const { headers, auth } = socket.handshake;
    const origin = headers.origin;
    const bearer = typeof auth.token === 'string' ? auth.token : undefined;
    // Navegador: origem obrigatória e permitida (o cookie viaja sozinho; sem isso, CSWSH).
    if (!bearer && (!origin || !this.env.CORS_ORIGINS.includes(origin)))
      throw new Error('origem não permitida');
    const token = bearer ?? parseCookies(headers.cookie)[this.cookies.access];
    if (!token) throw new Error('sem token');
    const verified = await this.verifier.verify(token);
    return { userId: verified.userId, roles: verified.roles };
  }

  @SubscribeMessage(ChatEvents.Join)
  async join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean }> {
    const requester = this.requesters.get(socket);
    const parsed = joinSchema.safeParse(body);
    if (!requester || !parsed.success) return { ok: false };
    if (!(await this.conversations.canJoin(requester, parsed.data.conversationId)))
      return { ok: false };
    await socket.join(room(parsed.data.conversationId));
    return { ok: true };
  }
}
