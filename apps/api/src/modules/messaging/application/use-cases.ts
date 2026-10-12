import { CONTRACT_CHAT_STATUSES, type Role, SCOPING_CHAT_STATUSES } from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { simpleEmail } from '../../../shared/application/simple-email.js';
import { DAY_MS } from '../../../shared/kernel/clock.js';
import { DomainError, NotFoundError } from '../../../shared/kernel/domain-error.js';
import { maskContacts } from '../../../shared/kernel/contact-detector.js';
import type { ConversationRecord, MessageRecord, MessagingDeps, ParticipantRole } from './ports.js';

export interface Requester {
  userId: string;
  roles: readonly Role[];
}

class ConversationNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Conversa não encontrada.');
  }
}

class ConversationClosedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(message: string) {
    super(message);
  }
}

const isAdmin = (requester: Requester) => requester.roles.includes('ADMIN');

/** Janela usada para contar reincidência de tentativas de contato. */
const RECENT_WINDOW_MS = 30 * DAY_MS;

const SCOPING_OPEN = new Set(SCOPING_CHAT_STATUSES);
const CONTRACT_OPEN = new Set(CONTRACT_CHAT_STATUSES);

abstract class MessagingUseCase {
  constructor(protected readonly deps: MessagingDeps) {}

  /**
   * Política de participação: escopo = cliente dono + especialistas (Admin); contrato = cliente +
   * freelancer, e o Admin lê/medeia. Fora disso, "não encontrada" (não revela existência).
   */
  protected roleIn(conversation: ConversationRecord, requester: Requester): ParticipantRole {
    if (requester.userId === conversation.clientId) return 'CLIENT';
    if (conversation.freelancerId && requester.userId === conversation.freelancerId)
      return 'FREELANCER';
    if (isAdmin(requester)) return 'SPECIALIST';
    throw new ConversationNotFoundError();
  }

  protected async load(conversationId: string, requester: Requester) {
    const conversation = await this.deps.conversations.find(conversationId);
    if (!conversation) throw new ConversationNotFoundError();
    return { conversation, role: this.roleIn(conversation, requester) };
  }
}

/** Abre (ou cria) as conversas de escopo e de contrato. */
export class OpenConversation extends MessagingUseCase {
  async forProject(requester: Requester, projectId: string): Promise<ConversationRecord> {
    const project = await this.deps.projects.find(projectId);
    if (!project || (project.clientId !== requester.userId && !isAdmin(requester)))
      throw new NotFoundError('Projeto', projectId);
    return (
      (await this.deps.conversations.findScoping(projectId)) ??
      this.deps.conversations.getOrCreate({
        id: this.deps.ids.next(),
        kind: 'SCOPING',
        projectId,
        contractId: null,
        clientId: project.clientId,
        freelancerId: null,
        lastMessageAt: null,
        createdAt: this.deps.clock.now(),
      })
    );
  }

  async forContract(requester: Requester, contractId: string): Promise<ConversationRecord> {
    const contract = await this.deps.contracts.find(contractId);
    const participant =
      contract &&
      (requester.userId === contract.clientId ||
        requester.userId === contract.freelancerId ||
        isAdmin(requester));
    if (!contract || !participant) throw new NotFoundError('Contrato', contractId);
    if (!CONTRACT_OPEN.has(contract.status))
      throw new ConversationClosedError('A conversa do contrato abre depois do pagamento.');
    return (
      (await this.deps.conversations.findByContract(contractId)) ??
      this.deps.conversations.getOrCreate({
        id: this.deps.ids.next(),
        kind: 'CONTRACT',
        projectId: contract.projectId,
        contractId,
        clientId: contract.clientId,
        freelancerId: contract.freelancerId,
        lastMessageAt: null,
        createdAt: this.deps.clock.now(),
      })
    );
  }
}

export interface ScreenResult {
  text: string;
  masked: boolean;
}

/**
 * Triagem de texto livre (chat e propostas): mascara contato, guarda o original cifrado como
 * infração e aplica a política de reincidência (advertência automática; alerta ao Admin).
 * API pública do módulo para outros módulos (ex.: propostas na distribuição).
 */
export class ScreenText extends MessagingUseCase {
  async execute(input: {
    userId: string;
    text: string;
    source: 'CHAT' | 'PROPOSAL';
    referenceId: string;
    projectId: string | null;
  }): Promise<ScreenResult> {
    const result = maskContacts(this.deps.detector, input.text);
    if (result.kinds.length === 0) return { text: input.text, masked: false };

    const now = this.deps.clock.now();
    await this.deps.violations.add({
      id: this.deps.ids.next(),
      userId: input.userId,
      source: input.source,
      referenceId: input.referenceId,
      projectId: input.projectId,
      kinds: result.kinds,
      maskedText: result.text,
      originalEncrypted: this.deps.cipher.encrypt(input.text),
      createdAt: now,
    });
    const recent = await this.deps.violations.countSince(
      input.userId,
      new Date(now.getTime() - RECENT_WINDOW_MS),
    );
    if (recent === (await this.deps.settings.get('moderation.warnAfterViolations'))) {
      await this.deps.moderation.add({
        id: this.deps.ids.next(),
        userId: input.userId,
        kind: 'WARNING',
        reason: `${recent} tentativas de compartilhar contato em 30 dias.`,
        actorId: null,
        createdAt: now,
      });
      await this.warn(input.userId);
    }
    return { text: result.text, masked: true };
  }

  private async warn(userId: string): Promise<void> {
    const person = await this.deps.people.find(userId);
    if (!person) return;
    await this.deps.mailer
      .send(
        simpleEmail(
          person.email,
          'moderation.warning',
          'Aviso: contato fora da plataforma',
          [
            `Olá, ${person.displayName}. Identificamos tentativas de compartilhar telefone, e-mail ou outros contatos em mensagens ou propostas.`,
            'Combinar pagamentos e conversas fora da plataforma tira a proteção da custódia, das entregas e da mediação. Novas tentativas podem levar à suspensão da conta.',
          ],
          { label: 'Ver regras de uso', url: `${this.deps.webAppUrl}/painel` },
        ),
      )
      .catch(() => undefined);
  }
}

export class SendMessage extends MessagingUseCase {
  constructor(
    deps: MessagingDeps,
    private readonly screen: ScreenText,
  ) {
    super(deps);
  }

  async execute(
    requester: Requester,
    conversationId: string,
    body: string,
  ): Promise<MessageRecord> {
    const message = await this.deps.uow.run(async () => {
      const { conversation, role } = await this.load(conversationId, requester);
      if (conversation.kind === 'SCOPING') {
        const project = await this.deps.projects.find(conversation.projectId);
        if (!project || !SCOPING_OPEN.has(project.status))
          throw new ConversationClosedError(
            'A conversa de escopo foi encerrada; use a conversa do contrato.',
          );
      }
      const id = this.deps.ids.next();
      const now = this.deps.clock.now();
      const screened = await this.screen.execute({
        userId: requester.userId,
        text: body,
        source: 'CHAT',
        referenceId: id,
        projectId: conversation.projectId,
      });
      const record: MessageRecord = {
        id,
        conversationId,
        senderId: requester.userId,
        senderRole: role,
        body: screened.text,
        masked: screened.masked,
        createdAt: now,
      };
      // Gravada antes de ser transmitida: nada aparece em tempo real sem estar no banco.
      await this.deps.messages.add(record);
      await this.deps.conversations.touch(conversationId, now);
      await this.deps.reads.markRead(conversationId, requester.userId, now);
      return record;
    });
    const sender = await this.deps.people.find(requester.userId);
    this.deps.realtime.publish(conversationId, {
      ...message,
      senderName: sender?.displayName ?? '',
    });
    return message;
  }
}

export class ReadConversations extends MessagingUseCase {
  async page(
    requester: Requester,
    conversationId: string,
    before: { createdAt: Date; id: string } | null,
    limit: number,
  ) {
    await this.load(conversationId, requester);
    const items = await this.deps.messages.page(conversationId, before, limit + 1);
    return { items: items.slice(0, limit), hasMore: items.length > limit };
  }

  async markRead(requester: Requester, conversationId: string): Promise<void> {
    await this.load(conversationId, requester);
    await this.deps.reads.markRead(conversationId, requester.userId, this.deps.clock.now());
  }

  async list(requester: Requester) {
    const conversations = await this.deps.conversations.listFor(
      requester.userId,
      isAdmin(requester),
      50,
    );
    const unread = await this.deps.reads.unreadCounts(
      requester.userId,
      conversations.map((c) => c.id),
    );
    return conversations.map((conversation) => ({
      conversation,
      unread: unread.get(conversation.id) ?? 0,
    }));
  }

  async unread(requester: Requester, conversationId: string): Promise<number> {
    return (
      (await this.deps.reads.unreadCounts(requester.userId, [conversationId])).get(
        conversationId,
      ) ?? 0
    );
  }

  /** Para o WebSocket: só entra na sala quem participa. */
  async canJoin(requester: Requester, conversationId: string): Promise<boolean> {
    try {
      await this.load(conversationId, requester);
      return true;
    } catch {
      return false;
    }
  }
}

/** Painel de moderação: infrações, leitura auditada do original, suspensão e reativação. */
export class Moderate extends MessagingUseCase {
  list(limit: number) {
    return this.deps.violations.listRecent(
      limit,
      new Date(this.deps.clock.now().getTime() - RECENT_WINDOW_MS),
    );
  }

  async reveal(adminId: string, violationId: string, meta: RequestMeta): Promise<string> {
    const violation = await this.deps.violations.find(violationId);
    if (!violation) throw new NotFoundError('Infração', violationId);
    await this.deps.audit.record({
      actorId: adminId,
      action: 'admin.violation_revealed',
      targetType: 'contact_violation',
      targetId: violationId,
      metadata: { userId: violation.userId },
      request: meta,
    });
    // Passado o prazo de retenção, só a versão mascarada continua guardada.
    if (violation.originalEncrypted === '')
      return 'O texto original foi apagado ao fim do prazo de retenção; ficou só a versão mascarada.';
    return this.deps.cipher.decrypt(violation.originalEncrypted);
  }

  async suspend(adminId: string, userId: string, reason: string, meta: RequestMeta): Promise<void> {
    await this.deps.uow.run(async () => {
      await this.deps.accounts.suspend(userId);
      await this.log(adminId, userId, 'SUSPENSION', reason, meta);
    });
    const person = await this.deps.people.find(userId);
    if (person) {
      await this.deps.mailer
        .send(
          simpleEmail(
            person.email,
            'moderation.suspended',
            'Sua conta foi suspensa',
            [
              `Olá, ${person.displayName}. Sua conta na Freelas 4 Devs foi suspensa.`,
              `Motivo: ${reason}`,
              'Se acredita que houve um engano, responda este e-mail.',
            ],
            { label: 'Falar com o suporte', url: `mailto:contato@freelas4devs.com.br` },
          ),
        )
        .catch(() => undefined);
    }
  }

  async reinstate(adminId: string, userId: string, meta: RequestMeta): Promise<void> {
    await this.deps.uow.run(async () => {
      await this.deps.accounts.reinstate(userId);
      await this.log(adminId, userId, 'REINSTATEMENT', 'Conta reativada pelo Admin.', meta);
    });
  }

  private async log(
    adminId: string,
    userId: string,
    kind: 'SUSPENSION' | 'REINSTATEMENT',
    reason: string,
    meta: RequestMeta,
  ) {
    const now = this.deps.clock.now();
    await this.deps.moderation.add({
      id: this.deps.ids.next(),
      userId,
      kind,
      reason,
      actorId: adminId,
      createdAt: now,
    });
    await this.deps.audit.record({
      actorId: adminId,
      action: kind === 'SUSPENSION' ? 'admin.user_suspended' : 'admin.user_reinstated',
      targetType: 'user',
      targetId: userId,
      metadata: { reason },
      request: meta,
    });
  }
}
