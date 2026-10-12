import type { ContractStatus, ProjectStatus } from '@f4d/contracts';
import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { Mailer } from '../../../shared/application/mailer.js';
import type { SecretCipher } from '../../../shared/application/secret-cipher.js';
import type { SettingsReader } from '../../../shared/application/settings-reader.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import type { ContactDetector, ContactKind } from '../../../shared/kernel/contact-detector.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';

export type ConversationKind = 'SCOPING' | 'CONTRACT';
export type ParticipantRole = 'CLIENT' | 'FREELANCER' | 'SPECIALIST';

export interface ConversationRecord {
  id: string;
  kind: ConversationKind;
  projectId: string;
  contractId: string | null;
  clientId: string;
  freelancerId: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: ParticipantRole;
  body: string;
  masked: boolean;
  createdAt: Date;
}

export interface ConversationRepository {
  find(id: string): Promise<ConversationRecord | null>;
  findScoping(projectId: string): Promise<ConversationRecord | null>;
  findByContract(contractId: string): Promise<ConversationRecord | null>;
  /** Cria se não existir (corrida resolvida pelo índice único); devolve a conversa vigente. */
  getOrCreate(record: ConversationRecord): Promise<ConversationRecord>;
  touch(id: string, at: Date): Promise<void>;
  /** Conversas do usuário; especialistas (Admin) veem também todas as de escopo. */
  listFor(userId: string, includeAllScoping: boolean, limit: number): Promise<ConversationRecord[]>;
}

export interface MessageRepository {
  add(message: MessageRecord): Promise<void>;
  /** Mais recentes primeiro, antes do cursor (createdAt, id). */
  page(
    conversationId: string,
    before: { createdAt: Date; id: string } | null,
    limit: number,
  ): Promise<MessageRecord[]>;
}

export interface ReadMarkers {
  markRead(conversationId: string, userId: string, at: Date): Promise<void>;
  /** Mensagens de outras pessoas depois da última leitura do usuário, por conversa. */
  unreadCounts(userId: string, conversationIds: readonly string[]): Promise<Map<string, number>>;
}

export interface ViolationRecord {
  id: string;
  userId: string;
  source: 'CHAT' | 'PROPOSAL';
  referenceId: string;
  projectId: string | null;
  kinds: ContactKind[];
  maskedText: string;
  originalEncrypted: string;
  createdAt: Date;
}

export interface ViolationView extends Omit<ViolationRecord, 'originalEncrypted'> {
  user: { displayName: string; email: string; status: 'ACTIVE' | 'SUSPENDED' | 'DELETED' };
  recentViolations: number;
}

export interface Violations {
  add(record: ViolationRecord): Promise<void>;
  countSince(userId: string, since: Date): Promise<number>;
  find(id: string): Promise<ViolationRecord | null>;
  listRecent(limit: number, since: Date): Promise<ViolationView[]>;
}

export interface ModerationLog {
  add(action: {
    id: string;
    userId: string;
    kind: 'WARNING' | 'SUSPENSION' | 'REINSTATEMENT';
    reason: string;
    actorId: string | null;
    createdAt: Date;
  }): Promise<void>;
}

export interface ProjectLookup {
  find(projectId: string): Promise<{
    id: string;
    clientId: string;
    title: string;
    status: ProjectStatus;
  } | null>;
}

export interface ContractLookup {
  find(contractId: string): Promise<{
    id: string;
    projectId: string;
    clientId: string;
    freelancerId: string;
    status: ContractStatus;
  } | null>;
}

export interface AccountControl {
  suspend(userId: string): Promise<boolean>;
  reinstate(userId: string): Promise<boolean>;
}

export interface PeopleDirectory {
  find(userId: string): Promise<{ displayName: string; email: string } | null>;
}

/** Transmissão em tempo real (Socket.IO) depois do commit; nunca bloqueia o envio. */
export interface RealtimePublisher {
  publish(conversationId: string, message: MessageRecord & { senderName: string }): void;
}

export interface MessagingDeps {
  conversations: ConversationRepository;
  messages: MessageRepository;
  reads: ReadMarkers;
  violations: Violations;
  moderation: ModerationLog;
  projects: ProjectLookup;
  contracts: ContractLookup;
  accounts: AccountControl;
  people: PeopleDirectory;
  realtime: RealtimePublisher;
  detector: ContactDetector;
  cipher: SecretCipher;
  settings: SettingsReader;
  mailer: Mailer;
  audit: AuditLogger;
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  webAppUrl: string;
}

export const MESSAGING_DEPS = Symbol('MESSAGING_DEPS');
export const REALTIME_PUBLISHER = Symbol('REALTIME_PUBLISHER');
