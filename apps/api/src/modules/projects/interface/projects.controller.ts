import { Controller, Inject } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AdminProjectDetail,
  type AdminProjectSummary,
  apiRoutes,
  type CursorPage,
  type Project as ProjectDto,
  type ProjectSummary,
  type ScopingMetrics,
} from '@f4d/contracts';
import { z } from 'zod';
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
import { decodeCursor, encodeCursor } from '../../../shared/interface/http/cursor.js';
import { PROJECTS_DEPS, type ProjectsDeps, type ProjectListItem } from '../application/ports.js';
import {
  AdminReadProjects,
  AnswerClarifications,
  CancelProject,
  CreateProject,
  ManageScope,
  ReadMyProjects,
  ReadScopingMetrics,
} from '../application/use-cases.js';
import type { Project } from '../domain/project.js';

const routes = apiRoutes.projects;
const keysetSchema = z.tuple([z.iso.datetime(), z.uuid()]);

const toKeyset = (cursor: string | undefined) => {
  const decoded = decodeCursor(cursor, keysetSchema);
  return decoded ? { createdAt: new Date(decoded[0]), id: decoded[1] } : null;
};

const page = <T extends { createdAt: Date; id: string }, R>(
  result: { items: T[]; hasMore: boolean },
  map: (item: T) => R,
): CursorPage<R> => {
  const last = result.items.at(-1);
  return {
    items: result.items.map(map),
    nextCursor:
      result.hasMore && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null,
  };
};

const toSummary = (item: ProjectListItem): ProjectSummary => ({
  id: item.id,
  title: item.title,
  type: item.type,
  status: item.status,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

/** Monta as respostas a partir do agregado. O cliente nunca vê nível, stacks e notas internas. */
class ProjectPresenter {
  constructor(private readonly deps: ProjectsDeps) {}

  async forClient(project: Project): Promise<ProjectDto> {
    const s = project.toSnapshot();
    const attachments = await this.deps.attachments.describe(s.attachmentIds);
    return {
      id: s.id,
      title: s.title,
      type: s.type,
      description: s.description,
      references: s.references,
      desiredDeadline: s.desiredDeadline,
      attachments,
      status: s.status,
      clarification: s.clarification
        ? { questions: s.clarification.questions, answers: s.clarification.answers }
        : null,
      estimate: s.estimate
        ? {
            summary: s.estimate.summary,
            priceRange: s.estimate.priceRange,
            durationDays: s.estimate.durationDays,
            features: s.estimate.features,
            assumptions: s.estimate.assumptions,
          }
        : null,
      estimateUnavailable: s.estimateFailed,
      // O cliente vê o escopo só depois de aprovado (o rascunho do especialista é interno).
      scope:
        s.scope && s.scopeApprovedAt
          ? (({ levelSlug: _level, ...visible }) => visible)(s.scope)
          : null,
      rejectionReason: s.rejectionReason,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async forAdmin(project: Project): Promise<AdminProjectDetail> {
    const s = project.toSnapshot();
    const [dto, person, runs, versions] = await Promise.all([
      this.forClient(project),
      this.deps.people.find(s.clientId),
      this.deps.aiRuns.list(s.id),
      this.deps.queries.listScopeVersions(s.id),
    ]);
    return {
      ...dto,
      estimate: s.estimate,
      scope: s.scope,
      scopeVersions: versions.map((version) => ({
        version: version.version,
        scope: version.scope,
        createdBy: version.createdBy,
        createdAt: version.createdAt.toISOString(),
      })),
      scopingStartedAt: s.scopingStartedAt?.toISOString() ?? null,
      scopeApprovedAt: s.scopeApprovedAt?.toISOString() ?? null,
      client: {
        userId: s.clientId,
        displayName: person?.displayName ?? '',
        email: person?.email ?? '',
      },
      aiRuns: runs.map((run) => ({
        round: run.round,
        outcome: run.outcome,
        model: run.model,
        promptVersion: run.promptVersion,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        durationMs: run.durationMs,
        createdAt: run.createdAt.toISOString(),
      })),
    };
  }
}

@Controller()
export class ProjectsController {
  private readonly presenter: ProjectPresenter;

  constructor(
    @Inject(PROJECTS_DEPS) deps: ProjectsDeps,
    private readonly createProject: CreateProject,
    private readonly readProjects: ReadMyProjects,
    private readonly answerClarifications: AnswerClarifications,
    private readonly cancelProject: CancelProject,
  ) {
    this.presenter = new ProjectPresenter(deps);
  }

  @ContractRoute(routes.createProject)
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  async create(
    @ValidRequest() { body }: ContractRequest<typeof routes.createProject>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ProjectDto> {
    return this.presenter.forClient(await this.createProject.execute(principal.userId, body));
  }

  @ContractRoute(routes.listMyProjects)
  async list(
    @ValidRequest() { query }: ContractRequest<typeof routes.listMyProjects>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<CursorPage<ProjectSummary>> {
    const result = await this.readProjects.list({
      clientId: principal.userId,
      limit: query.limit,
      after: toKeyset(query.cursor),
    });
    return page(result, toSummary);
  }

  @ContractRoute(routes.getProject)
  async get(
    @ValidRequest() { params }: ContractRequest<typeof routes.getProject>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ProjectDto> {
    return this.presenter.forClient(
      await this.readProjects.get(principal.userId, params.projectId),
    );
  }

  @ContractRoute(routes.answerClarifications)
  async answer(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.answerClarifications>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ProjectDto> {
    return this.presenter.forClient(
      await this.answerClarifications.execute(principal.userId, params.projectId, body.answers),
    );
  }

  @ContractRoute(routes.cancelProject)
  async cancel(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.cancelProject>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<ProjectDto> {
    return this.presenter.forClient(
      await this.cancelProject.execute(
        principal.userId,
        params.projectId,
        body.reason ?? null,
        meta,
      ),
    );
  }
}

@Controller()
export class AdminProjectsController {
  private readonly presenter: ProjectPresenter;

  constructor(
    @Inject(PROJECTS_DEPS) deps: ProjectsDeps,
    private readonly adminProjects: AdminReadProjects,
    private readonly manageScope: ManageScope,
    private readonly metrics: ReadScopingMetrics,
  ) {
    this.presenter = new ProjectPresenter(deps);
  }

  @ContractRoute(routes.adminListProjects)
  async list(
    @ValidRequest() { query }: ContractRequest<typeof routes.adminListProjects>,
  ): Promise<CursorPage<AdminProjectSummary>> {
    const result = await this.adminProjects.list({
      status: query.status,
      limit: query.limit,
      after: toKeyset(query.cursor),
    });
    return page(result, (item) => ({ ...toSummary(item), client: item.client }));
  }

  @ContractRoute(routes.adminGetProject)
  async get(
    @ValidRequest() { params }: ContractRequest<typeof routes.adminGetProject>,
  ): Promise<AdminProjectDetail> {
    return this.presenter.forAdmin(await this.adminProjects.get(params.projectId));
  }

  @ContractRoute(routes.adminSaveScope)
  async saveScope(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminSaveScope>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<AdminProjectDetail> {
    const scope = { ...body, notesForFreelancers: body.notesForFreelancers ?? null };
    return this.presenter.forAdmin(
      await this.manageScope.save(principal.userId, params.projectId, scope, meta),
    );
  }

  @ContractRoute(routes.adminApproveScope)
  async approve(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminApproveScope>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<AdminProjectDetail> {
    return this.presenter.forAdmin(
      await this.manageScope.approve(principal.userId, params.projectId, body.version, meta),
    );
  }

  @ContractRoute(routes.adminRejectProject)
  async reject(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminRejectProject>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<AdminProjectDetail> {
    return this.presenter.forAdmin(
      await this.manageScope.reject(principal.userId, params.projectId, body.reason, meta),
    );
  }

  @ContractRoute(routes.adminReopenScope)
  async reopen(
    @ValidRequest() { params }: ContractRequest<typeof routes.adminReopenScope>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<AdminProjectDetail> {
    return this.presenter.forAdmin(
      await this.manageScope.reopen(principal.userId, params.projectId, meta),
    );
  }

  @ContractRoute(routes.adminScopingMetrics)
  scopingMetrics(): Promise<ScopingMetrics> {
    return this.metrics.execute();
  }
}
