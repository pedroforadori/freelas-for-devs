import {
  type ClarificationAnswer,
  type CreateProjectRequest,
  PROJECT_LIMITS,
} from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { DAY_MS } from '../../../shared/kernel/clock.js';
import {
  InvalidAttachmentsError,
  ProjectLimitError,
  ProjectNotFoundError,
} from '../domain/errors.js';
import { Project } from '../domain/project.js';
import { clarificationNeededEmail, estimateReadyEmail } from './emails.js';
import { normalizeEstimate, normalizeQuestions } from './estimate-policy.js';
import type { AdminProjectListItem, Keyset, ProjectListItem, ProjectsDeps } from './ports.js';

abstract class ProjectsUseCase {
  constructor(protected readonly deps: ProjectsDeps) {}

  /**
   * Política de posse: só o cliente dono enxerga o projeto. Projeto alheio responde
   * "não encontrado" — não revela que o id existe (IDOR).
   */
  protected async loadOwned(clientId: string, projectId: string): Promise<Project> {
    const project = await this.deps.projects.find(projectId);
    if (!project || project.clientId !== clientId) throw new ProjectNotFoundError();
    return project;
  }

  protected projectUrl(projectId: string): string {
    return `${this.deps.webAppUrl}/projetos/${projectId}`;
  }
}

export class CreateProject extends ProjectsUseCase {
  async execute(clientId: string, input: CreateProjectRequest): Promise<Project> {
    const { queries, attachments, clock, ids } = this.deps;
    const now = clock.now();

    // Cada publicação consome uma estimativa de IA: limites por cliente contêm abuso e custo.
    const since = new Date(now.getTime() - DAY_MS);
    if ((await queries.countCreatedSince(clientId, since)) >= PROJECT_LIMITS.perDay) {
      throw new ProjectLimitError(
        `Você pode publicar até ${PROJECT_LIMITS.perDay} projetos a cada 24 horas.`,
        60 * 60,
      );
    }
    if ((await queries.countOpen(clientId)) >= PROJECT_LIMITS.openMax) {
      throw new ProjectLimitError(
        `Você já tem ${PROJECT_LIMITS.openMax} projetos em andamento. Conclua ou cancele um deles para publicar outro.`,
      );
    }

    const attachmentIds = [...new Set(input.attachmentIds)];
    if (attachmentIds.length > 0) {
      const usable = await attachments.usableBy(clientId, attachmentIds);
      if (usable.length !== attachmentIds.length) throw new InvalidAttachmentsError();
    }

    const project = Project.submit({
      id: ids.next(),
      clientId,
      title: input.title,
      type: input.type,
      description: input.description,
      references: input.references,
      desiredDeadline: input.desiredDeadline ?? null,
      attachmentIds,
      now,
    });
    await this.deps.projects.save(project);
    return project;
  }
}

export interface ProjectPage<T> {
  items: T[];
  hasMore: boolean;
}

export class ReadMyProjects extends ProjectsUseCase {
  get(clientId: string, projectId: string): Promise<Project> {
    return this.loadOwned(clientId, projectId);
  }

  async list(input: {
    clientId: string;
    limit: number;
    after: Keyset | null;
  }): Promise<ProjectPage<ProjectListItem>> {
    const items = await this.deps.queries.listByClient({ ...input, limit: input.limit + 1 });
    return { items: items.slice(0, input.limit), hasMore: items.length > input.limit };
  }
}

export class AnswerClarifications extends ProjectsUseCase {
  execute(clientId: string, projectId: string, answers: ClarificationAnswer[]): Promise<Project> {
    return this.deps.uow.run(async () => {
      const project = await this.loadOwned(clientId, projectId);
      project.answerClarifications(answers, this.deps.clock.now());
      await this.deps.projects.save(project);
      return project;
    });
  }
}

export class CancelProject extends ProjectsUseCase {
  execute(
    clientId: string,
    projectId: string,
    reason: string | null,
    meta: RequestMeta,
  ): Promise<Project> {
    return this.deps.uow.run(async () => {
      const project = await this.loadOwned(clientId, projectId);
      project.cancel(reason, this.deps.clock.now());
      await this.deps.projects.save(project);
      await this.deps.audit.record({
        actorId: clientId,
        action: 'projects.cancelled',
        targetType: 'project',
        targetId: projectId,
        request: meta,
      });
      return project;
    });
  }
}

export type EstimationResult = 'skipped' | 'clarify' | 'estimate';

/**
 * Executado pelo worker. A chamada à IA acontece fora de transação (leva segundos); antes de
 * gravar, o projeto é relido e a rodada conferida — se o cliente cancelou ou já respondeu,
 * o resultado obsoleto é descartado. Erros sobem para o job ser repetido com backoff.
 */
export class GenerateEstimate extends ProjectsUseCase {
  async execute(projectId: string, round: number): Promise<EstimationResult> {
    const { projects, estimator, catalog, clock } = this.deps;
    const project = await projects.find(projectId);
    if (!project?.awaitsEstimate(round)) return 'skipped';

    const context = { levels: await catalog.listLevels(), stacks: await catalog.listStacks() };
    const startedAt = clock.now();
    let run;
    try {
      run = await estimator.estimate(project.brief(), context);
    } catch (error) {
      await this.logRun(projectId, round, startedAt, {
        outcome: 'ERROR',
        model: estimator.model,
        promptVersion: estimator.promptVersion,
        inputTokens: 0,
        outputTokens: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const result = await this.deps.uow.run(async (): Promise<EstimationResult> => {
      const current = await projects.find(projectId);
      if (!current?.awaitsEstimate(round)) return 'skipped';
      const now = clock.now();
      const { outcome } = run;
      // Sem perguntas permitidas (2ª rodada), a IA é obrigada a estimar; se insistir, é falha.
      if (outcome.kind === 'clarify' && !current.brief().allowQuestions)
        throw new Error('O estimador pediu esclarecimentos de novo; esperado uma estimativa.');

      if (outcome.kind === 'clarify') {
        current.requestClarification(normalizeQuestions(outcome.questions), now);
      } else {
        current.completeEstimate(normalizeEstimate(outcome.estimate, context), now);
      }
      await projects.save(current);
      await this.logRun(projectId, round, startedAt, {
        ...run.usage,
        outcome: outcome.kind === 'clarify' ? 'CLARIFY' : 'ESTIMATE',
        error: null,
      });
      return outcome.kind;
    });

    if (result !== 'skipped') await this.notify(project, result);
    return result;
  }

  private logRun(
    projectId: string,
    round: number,
    startedAt: Date,
    entry: {
      outcome: 'ESTIMATE' | 'CLARIFY' | 'ERROR';
      model: string;
      promptVersion: string;
      inputTokens: number;
      outputTokens: number;
      error: string | null;
    },
  ) {
    const now = this.deps.clock.now();
    return this.deps.aiRuns.record({
      id: this.deps.ids.next(),
      projectId,
      round,
      ...entry,
      error: entry.error?.slice(0, 2000) ?? null,
      durationMs: Math.max(0, now.getTime() - startedAt.getTime()),
      createdAt: now,
    });
  }

  private async notify(project: Project, result: 'clarify' | 'estimate'): Promise<void> {
    const person = await this.deps.people.find(project.clientId);
    if (!person) return;
    const url = this.projectUrl(project.id);
    const build = result === 'clarify' ? clarificationNeededEmail : estimateReadyEmail;
    await this.deps.mailer
      .send(build(person.email, person.displayName, project.title, url))
      .catch(() => undefined);
  }
}

/** Última tentativa do job falhou: o projeto segue sem estimativa para o especialista. */
export class FailEstimate extends ProjectsUseCase {
  execute(projectId: string, round: number): Promise<boolean> {
    return this.deps.uow.run(async () => {
      const project = await this.deps.projects.find(projectId);
      if (!project?.awaitsEstimate(round)) return false;
      project.failEstimate(this.deps.clock.now());
      await this.deps.projects.save(project);
      return true;
    });
  }
}

export class AdminReadProjects extends ProjectsUseCase {
  async list(
    input: Parameters<ProjectsDeps['queries']['listByStatus']>[0],
  ): Promise<ProjectPage<AdminProjectListItem>> {
    const items = await this.deps.queries.listByStatus({ ...input, limit: input.limit + 1 });
    return { items: items.slice(0, input.limit), hasMore: items.length > input.limit };
  }

  async get(projectId: string): Promise<Project> {
    const project = await this.deps.projects.find(projectId);
    if (!project) throw new ProjectNotFoundError();
    return project;
  }
}
