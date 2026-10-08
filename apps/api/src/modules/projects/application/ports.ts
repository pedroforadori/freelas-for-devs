import type {
  ClarificationQuestion,
  Estimate,
  FileStatus,
  Level,
  ProjectStatus,
  ProjectType,
  Stack,
} from '@f4d/contracts';
import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { Mailer } from '../../../shared/application/mailer.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type { EstimationBrief, Project } from '../domain/project.js';

export interface ProjectRepository {
  find(id: string): Promise<Project | null>;
  /** Lock otimista; grava anexos e eventos (outbox) na mesma transação. */
  save(project: Project): Promise<void>;
}

export interface ProjectListItem {
  id: string;
  title: string;
  type: ProjectType;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminProjectListItem extends ProjectListItem {
  client: { userId: string; displayName: string; email: string };
}

export interface Keyset {
  createdAt: Date;
  id: string;
}

/** Leituras que não passam pelo agregado (listas e contagens). */
export interface ProjectQueries {
  countCreatedSince(clientId: string, since: Date): Promise<number>;
  /** Projetos ainda em andamento (não cancelados). */
  countOpen(clientId: string): Promise<number>;
  /** Mais recentes primeiro. */
  listByClient(input: {
    clientId: string;
    limit: number;
    after: Keyset | null;
  }): Promise<ProjectListItem[]>;
  /** Mais antigos primeiro (ordem de atendimento do Admin). */
  listByStatus(input: {
    status: ProjectStatus;
    limit: number;
    after: Keyset | null;
  }): Promise<AdminProjectListItem[]>;
}

export interface AttachmentView {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  status: FileStatus;
}

/** Leitura dos arquivos enviados (o módulo de arquivos é a fonte). */
export interface AttachmentDirectory {
  /** Dos ids informados, os que são do dono, são anexos de projeto e não foram recusados. */
  usableBy(ownerId: string, fileIds: readonly string[]): Promise<string[]>;
  describe(fileIds: readonly string[]): Promise<AttachmentView[]>;
}

export interface ProjectCatalog {
  listLevels(): Promise<Level[]>;
  listStacks(): Promise<Stack[]>;
}

export interface PeopleDirectory {
  find(userId: string): Promise<{ displayName: string; email: string } | null>;
}

export interface AiUsage {
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
}

export type EstimatorOutcome =
  | { kind: 'clarify'; questions: ClarificationQuestion[] }
  | { kind: 'estimate'; estimate: Estimate };

export interface EstimatorRun {
  outcome: EstimatorOutcome;
  usage: AiUsage;
}

/**
 * Port da estimativa (ADR-0013). O adapter de produção usa Claude com saída estruturada; o
 * heurístico atende desenvolvimento e testes. A saída é sempre sugestão: o Admin revisa.
 */
export interface ProjectEstimator {
  readonly model: string;
  readonly promptVersion: string;
  estimate(
    brief: EstimationBrief,
    context: { levels: Level[]; stacks: Stack[] },
  ): Promise<EstimatorRun>;
}

export interface AiRunEntry {
  projectId: string;
  round: number;
  outcome: 'ESTIMATE' | 'CLARIFY' | 'ERROR';
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  error: string | null;
  createdAt: Date;
}

export interface AiRunLog {
  record(entry: AiRunEntry & { id: string }): Promise<void>;
  list(projectId: string): Promise<AiRunEntry[]>;
}

export interface ProjectsDeps {
  projects: ProjectRepository;
  queries: ProjectQueries;
  attachments: AttachmentDirectory;
  catalog: ProjectCatalog;
  people: PeopleDirectory;
  aiRuns: AiRunLog;
  estimator: ProjectEstimator;
  mailer: Mailer;
  audit: AuditLogger;
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  webAppUrl: string;
}

export const PROJECTS_DEPS = Symbol('PROJECTS_DEPS');
