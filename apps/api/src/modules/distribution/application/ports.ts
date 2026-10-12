import type {
  AdminDistribution,
  AdminQueueEntry,
  ClientScope,
  InvitationStatus,
  InvitationSummary,
  MyQueueStatus,
  ProjectStatus,
  ProjectType,
  ProposalForClient,
  QueueState,
  Scope,
} from '@f4d/contracts';
import type { Mailer } from '../../../shared/application/mailer.js';
import type { SettingsReader } from '../../../shared/application/settings-reader.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type { QueueEntry } from '../domain/queue-entry.js';
import type { DistributionRound } from '../domain/round.js';

export interface RoundRepository {
  findByInvitation(invitationId: string): Promise<DistributionRound | null>;
  /** Rodada em andamento (OPEN ou SELECTED) do projeto. */
  findActiveByProject(projectId: string): Promise<DistributionRound | null>;
  /** Lock otimista; grava convites e eventos (outbox) na mesma transação. */
  save(round: DistributionRound): Promise<void>;
  /** Rodadas abertas com convites vencidos (reconciliador de prazos). */
  withOverdueInvitations(now: Date, limit: number): Promise<string[]>;
  findById(roundId: string): Promise<DistributionRound | null>;
  /** Rodadas em andamento com convite, proposta ou espera do freelancer. */
  activeWithFreelancer(freelancerId: string): Promise<string[]>;
}

export interface CandidateQuery {
  projectId: string;
  levelSlug: string;
  projectType: ProjectType;
  requiredStacks: string[];
  clientId: string;
  maxOpenInvitations: number;
  /** Quanto o melhor desempenho adianta a vez (e o pior atrasa), em horas. */
  performanceBonusHours: number;
  limit: number;
}

export interface QueueRepository {
  find(userId: string): Promise<QueueEntry | null>;
  findMany(userIds: readonly string[]): Promise<QueueEntry[]>;
  save(entry: QueueEntry): Promise<void>;
  /**
   * Serializa a distribuição de um nível (advisory lock da transação): dois projetos do mesmo
   * nível nunca disputam os mesmos freelancers ao mesmo tempo.
   */
  lockLevel(levelSlug: string): Promise<void>;
  /**
   * Próximos elegíveis, na ordem da fila: prioridade (quem espera há mais tempo) e depois
   * round-robin por último convite. Linhas bloqueadas (FOR UPDATE SKIP LOCKED).
   */
  nextCandidates(query: CandidateQuery): Promise<string[]>;
}

export interface InvitationView {
  id: string;
  status: InvitationStatus;
  invitedAt: Date;
  deadlineAt: Date;
  projectId: string;
  proposal: {
    amountCents: number;
    deadlineDays: number;
    message: string;
    submittedAt: Date;
    updatedAt: Date;
  } | null;
}

/** Leituras de apresentação (listas, posição na fila, visões do Admin). */
export interface DistributionQueries {
  listForFreelancer(input: {
    freelancerId: string;
    view: 'open' | 'history';
    limit: number;
    after: { invitedAt: Date; id: string } | null;
  }): Promise<
    (Omit<InvitationSummary, 'invitedAt' | 'deadlineAt'> & { invitedAt: Date; deadlineAt: Date })[]
  >;
  proposalsForProject(projectId: string): Promise<{
    awaitingResponses: number;
    proposals: (Omit<ProposalForClient, 'submittedAt'> & { submittedAt: Date })[];
  }>;
  myQueueStatus(userId: string): Promise<MyQueueStatus>;
  adminQueue(input: { levelSlug: string | null; state: QueueState }): Promise<AdminQueueEntry[]>;
  adminQueueEntry(userId: string): Promise<AdminQueueEntry | null>;
  adminDistribution(projectId: string): Promise<AdminDistribution>;
}

export interface ProjectForDistribution {
  id: string;
  clientId: string;
  title: string;
  type: ProjectType;
  description: string;
  status: ProjectStatus;
  scope: Scope | null;
  attachmentIds: string[];
}

/** Concede leitura de arquivos (módulo de arquivos). */
export interface FileAccess {
  grant(fileIds: readonly string[], userId: string, reason: string): Promise<void>;
}

/** Porta para o módulo de projetos (implementada sobre a fachada pública dele). */
export interface ProjectGateway {
  find(projectId: string): Promise<ProjectForDistribution | null>;
  startDistribution(projectId: string): Promise<void>;
  exhaustCandidates(projectId: string): Promise<void>;
  hire(projectId: string, invitationId: string): Promise<void>;
  revertHiring(projectId: string): Promise<void>;
}

export interface PeopleDirectory {
  find(userId: string): Promise<{ displayName: string; email: string } | null>;
}

export interface DistributionDeps {
  rounds: RoundRepository;
  queue: QueueRepository;
  queries: DistributionQueries;
  projects: ProjectGateway;
  people: PeopleDirectory;
  files: FileAccess;
  settings: SettingsReader;
  mailer: Mailer;
  audit: AuditLogger;
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  webAppUrl: string;
}

export const DISTRIBUTION_DEPS = Symbol('DISTRIBUTION_DEPS');

/** Triagem de contato no texto da proposta (API pública do módulo de mensagens). */
export interface ProposalScreener {
  execute(input: {
    userId: string;
    text: string;
    source: 'PROPOSAL';
    referenceId: string;
    projectId: string;
  }): Promise<{ text: string; masked: boolean }>;
}

/** Escopo visível ao freelancer convidado (sem o nível interno). */
export const toClientScope = (scope: Scope): ClientScope => {
  const { levelSlug: _level, ...visible } = scope;
  return visible;
};
