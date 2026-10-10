import type { ProjectStatus, ProjectType, Scope } from '@f4d/contracts';
import { ProjectNotFoundError } from '../domain/errors.js';
import type { Project } from '../domain/project.js';
import type { ProjectsDeps } from './ports.js';

export interface ProjectForDistribution {
  id: string;
  clientId: string;
  title: string;
  type: ProjectType;
  description: string;
  status: ProjectStatus;
  /** Escopo aprovado (nulo antes da aprovação). */
  scope: Scope | null;
}

/**
 * API pública do módulo de projetos para a distribuição (docs/architecture.md §2): leitura do
 * escopo aprovado e as transições que a fila provoca. Participa da transação de quem chama.
 */
export class ProjectsFacade {
  constructor(private readonly deps: ProjectsDeps) {}

  async find(projectId: string): Promise<ProjectForDistribution | null> {
    const project = await this.deps.projects.find(projectId);
    if (!project) return null;
    const s = project.toSnapshot();
    return {
      id: s.id,
      clientId: s.clientId,
      title: s.title,
      type: s.type,
      description: s.description,
      status: s.status,
      scope: s.scopeApprovedAt ? s.scope : null,
    };
  }

  startDistribution(projectId: string): Promise<void> {
    return this.change(projectId, (project, now) => project.startDistribution(now));
  }

  exhaustCandidates(projectId: string): Promise<void> {
    return this.change(projectId, (project, now) => project.exhaustCandidates(now));
  }

  hire(projectId: string, invitationId: string): Promise<void> {
    return this.change(projectId, (project, now) => project.hire(invitationId, now));
  }

  startWork(projectId: string): Promise<void> {
    return this.change(projectId, (project, now) => project.startWork(now));
  }

  revertHiring(projectId: string): Promise<void> {
    return this.change(projectId, (project, now) => project.revertHiring(now));
  }

  private change(projectId: string, apply: (project: Project, now: Date) => void): Promise<void> {
    return this.deps.uow.run(async () => {
      const project = await this.deps.projects.find(projectId);
      if (!project) throw new ProjectNotFoundError();
      apply(project, this.deps.clock.now());
      await this.deps.projects.save(project);
    });
  }
}
