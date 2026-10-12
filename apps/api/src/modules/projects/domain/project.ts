import type {
  ClarificationAnswer,
  ClarificationQuestion,
  DesiredDeadline,
  Estimate,
  ProjectStatus,
  ProjectType,
  Scope,
} from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';
import { defineStateMachine } from '../../../shared/kernel/state-machine.js';
import {
  InvalidClarificationAnswersError,
  ScopeRuleError,
  StaleScopeVersionError,
} from './errors.js';

export interface Clarification {
  questions: ClarificationQuestion[];
  answers: ClarificationAnswer[] | null;
  askedAt: Date;
  answeredAt: Date | null;
}

export interface ProjectSnapshot {
  id: string;
  clientId: string;
  title: string;
  type: ProjectType;
  description: string;
  references: string[];
  desiredDeadline: DesiredDeadline | null;
  attachmentIds: string[];
  status: ProjectStatus;
  estimationRound: number;
  clarification: Clarification | null;
  estimate: Estimate | null;
  estimateFailed: boolean;
  scope: Scope | null;
  /** 0 = nenhuma versão salva. */
  scopeVersion: number;
  scopingStartedAt: Date | null;
  scopeApprovedAt: Date | null;
  scopeApprovedBy: string | null;
  rejectionReason: string | null;
  rejectedAt: Date | null;
  cancelReason: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** Nova versão do escopo salva pelo especialista, a gravar no histórico (scope_versions). */
export interface ScopeVersionRecord {
  version: number;
  scope: Scope;
  createdBy: string;
  createdAt: Date;
}

/** Limites do escopo vindos das configurações do Admin. */
export interface ScopeLimits {
  minPriceCents: number;
  maxDeadlineDays: number;
}

type ProjectEvent =
  | 'requestClarification'
  | 'answerClarifications'
  | 'completeEstimate'
  | 'failEstimate'
  | 'saveScope'
  | 'approveScope'
  | 'reject'
  | 'reopenScope'
  | 'startDistribution'
  | 'exhaustCandidates'
  | 'hire'
  | 'startWork'
  | 'revertHiring'
  | 'complete'
  | 'closeByDispute'
  | 'cancel';

/**
 * Ciclo do projeto até a fila (docs/architecture.md §4.1). A IA pode pedir esclarecimentos
 * uma única vez: depois das respostas, ela precisa estimar — sem laço de perguntas. O especialista
 * só aprova um escopo já salvo; um aprovado pode ser reaberto enquanto a distribuição não começou.
 */
export const projectMachine = defineStateMachine<
  ProjectStatus,
  ProjectEvent,
  { alreadyAsked: boolean; hasScope: boolean }
>({
  name: 'Project',
  initial: 'ESTIMATING',
  terminal: ['COMPLETED', 'CLOSED_BY_DISPUTE', 'REJECTED', 'CANCELLED'],
  transitions: {
    ESTIMATING: {
      requestClarification: {
        target: 'AWAITING_CLARIFICATION',
        guard: ({ alreadyAsked }) => !alreadyAsked || 'as perguntas já foram feitas uma vez',
      },
      completeEstimate: 'SCOPING',
      failEstimate: 'SCOPING',
      cancel: 'CANCELLED',
    },
    AWAITING_CLARIFICATION: { answerClarifications: 'ESTIMATING', cancel: 'CANCELLED' },
    SCOPING: {
      saveScope: 'SCOPING',
      approveScope: {
        target: 'READY_FOR_QUEUE',
        guard: ({ hasScope }) => hasScope || 'salve uma versão do escopo antes de aprovar',
      },
      reject: 'REJECTED',
      cancel: 'CANCELLED',
    },
    READY_FOR_QUEUE: {
      reopenScope: 'SCOPING',
      startDistribution: 'DISTRIBUTING',
      cancel: 'CANCELLED',
    },
    DISTRIBUTING: { exhaustCandidates: 'NO_CANDIDATES', hire: 'HIRING', cancel: 'CANCELLED' },
    // Sem devs no nível: o especialista ajusta nível/stacks e aprova de novo (nova rodada).
    NO_CANDIDATES: { reopenScope: 'SCOPING', cancel: 'CANCELLED' },
    // Pagamento confirmado → em andamento; prazo de pagamento vencido → volta às propostas.
    HIRING: { startWork: 'IN_PROGRESS', revertHiring: 'DISTRIBUTING', cancel: 'CANCELLED' },
    // Aprovação da entrega final (cliente ou automática) ou decisão de disputa executada (F8).
    IN_PROGRESS: { complete: 'COMPLETED', closeByDispute: 'CLOSED_BY_DISPUTE' },
    COMPLETED: {},
    CLOSED_BY_DISPUTE: {},
    REJECTED: {},
    CANCELLED: {},
  },
});

export const ProjectEvents = {
  Submitted: 'projects.ProjectSubmitted',
  ClarificationRequested: 'projects.ClarificationRequested',
  ClarificationsAnswered: 'projects.ClarificationsAnswered',
  EstimateReady: 'projects.EstimateReady',
  EstimateFailed: 'projects.EstimateFailed',
  ScopeSaved: 'projects.ScopeSaved',
  ScopeApproved: 'projects.ScopeApproved',
  ScopeReopened: 'projects.ScopeReopened',
  DistributionStarted: 'projects.DistributionStarted',
  NoCandidates: 'projects.NoCandidates',
  HiringStarted: 'projects.HiringStarted',
  WorkStarted: 'projects.WorkStarted',
  HiringReverted: 'projects.HiringReverted',
  Completed: 'projects.ProjectCompleted',
  ClosedByDispute: 'projects.ProjectClosedByDispute',
  Rejected: 'projects.ProjectRejected',
  Cancelled: 'projects.ProjectCancelled',
} as const;

/** Eventos que pedem uma (nova) estimativa ao worker. */
export const ESTIMATION_TRIGGERS: readonly string[] = [
  ProjectEvents.Submitted,
  ProjectEvents.ClarificationsAnswered,
];

/** Dados que o estimador recebe: só texto do cliente, nunca anexos (custo e segurança). */
export interface EstimationBrief {
  title: string;
  type: ProjectType;
  description: string;
  references: string[];
  desiredDeadline: DesiredDeadline | null;
  /** Perguntas já feitas e as respostas, em texto. */
  clarifications: { question: string; answer: string }[];
  /** A IA ainda pode pedir esclarecimentos (só na primeira rodada). */
  allowQuestions: boolean;
}

export class Project extends AggregateRoot {
  protected readonly aggregateType = 'Project';
  private newScopeVersions: ScopeVersionRecord[] = [];

  private constructor(
    private props: Omit<ProjectSnapshot, 'id' | 'version'>,
    id: string,
    version: number,
  ) {
    super(id, version);
  }

  static submit(input: {
    id: string;
    clientId: string;
    title: string;
    type: ProjectType;
    description: string;
    references: string[];
    desiredDeadline: DesiredDeadline | null;
    attachmentIds: string[];
    now: Date;
  }): Project {
    const { id, now, ...rest } = input;
    const project = new Project(
      {
        ...rest,
        references: [...new Set(rest.references)],
        attachmentIds: [...new Set(rest.attachmentIds)],
        status: 'ESTIMATING',
        estimationRound: 1,
        clarification: null,
        estimate: null,
        estimateFailed: false,
        scope: null,
        scopeVersion: 0,
        scopingStartedAt: null,
        scopeApprovedAt: null,
        scopeApprovedBy: null,
        rejectionReason: null,
        rejectedAt: null,
        cancelReason: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      },
      id,
      0,
    );
    project.record(ProjectEvents.Submitted, now, {
      projectId: id,
      clientId: rest.clientId,
      round: 1,
    });
    return project;
  }

  static rehydrate(snapshot: ProjectSnapshot): Project {
    const { id, version, ...props } = snapshot;
    return new Project(structuredClone(props), id, version);
  }

  get clientId(): string {
    return this.props.clientId;
  }
  get status(): ProjectStatus {
    return this.props.status;
  }
  get estimationRound(): number {
    return this.props.estimationRound;
  }
  get title(): string {
    return this.props.title;
  }

  /** O job de estimativa da `round` ainda é o vigente (projeto não mudou desde então). */
  awaitsEstimate(round: number): boolean {
    return this.props.status === 'ESTIMATING' && this.props.estimationRound === round;
  }

  brief(): EstimationBrief {
    const p = this.props;
    return {
      title: p.title,
      type: p.type,
      description: p.description,
      references: p.references,
      desiredDeadline: p.desiredDeadline,
      clarifications: p.clarification?.answers
        ? p.clarification.questions.map((question) => ({
            question: question.question,
            answer: answerText(question, p.clarification?.answers ?? []),
          }))
        : [],
      allowQuestions: p.clarification === null,
    };
  }

  requestClarification(questions: ClarificationQuestion[], now: Date): void {
    this.transition('requestClarification');
    this.props.clarification = { questions, answers: null, askedAt: now, answeredAt: null };
    this.props.updatedAt = now;
    this.record(ProjectEvents.ClarificationRequested, now, {
      projectId: this.id,
      clientId: this.props.clientId,
    });
  }

  /** Toda pergunta precisa de uma resposta: uma das opções ou texto livre (se permitido). */
  answerClarifications(answers: ClarificationAnswer[], now: Date): void {
    const clarification = this.props.clarification;
    if (this.props.status !== 'AWAITING_CLARIFICATION' || !clarification) {
      this.transition('answerClarifications');
      return;
    }
    const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
    if (byQuestion.size !== answers.length)
      throw new InvalidClarificationAnswersError('Responda cada pergunta uma única vez.');
    for (const question of clarification.questions) {
      const answer = byQuestion.get(question.id);
      if (!answer) throw new InvalidClarificationAnswersError('Responda todas as perguntas.');
      if (answer.optionId && !question.options.some((option) => option.id === answer.optionId))
        throw new InvalidClarificationAnswersError('Opção inválida para uma das perguntas.');
      if (answer.other && !question.allowOther)
        throw new InvalidClarificationAnswersError('Escolha uma das opções.');
    }
    if (byQuestion.size !== clarification.questions.length)
      throw new InvalidClarificationAnswersError('Há respostas para perguntas inexistentes.');

    this.transition('answerClarifications');
    this.props.clarification = {
      ...clarification,
      answers: clarification.questions.map((question) => byQuestion.get(question.id)!),
      answeredAt: now,
    };
    this.props.estimationRound += 1;
    this.props.updatedAt = now;
    this.record(ProjectEvents.ClarificationsAnswered, now, {
      projectId: this.id,
      clientId: this.props.clientId,
      round: this.props.estimationRound,
    });
  }

  completeEstimate(estimate: Estimate, now: Date): void {
    this.transition('completeEstimate');
    this.props.estimate = estimate;
    this.props.estimateFailed = false;
    this.props.scopingStartedAt = now;
    this.props.updatedAt = now;
    this.record(ProjectEvents.EstimateReady, now, {
      projectId: this.id,
      clientId: this.props.clientId,
    });
  }

  /** A IA falhou de vez: o projeto segue para o especialista, que estima manualmente. */
  failEstimate(now: Date): void {
    this.transition('failEstimate');
    this.props.estimateFailed = true;
    this.props.scopingStartedAt = now;
    this.props.updatedAt = now;
    this.record(ProjectEvents.EstimateFailed, now, {
      projectId: this.id,
      clientId: this.props.clientId,
    });
  }

  get scopeVersion(): number {
    return this.props.scopeVersion;
  }
  get scope(): Scope | null {
    return this.props.scope;
  }

  /**
   * Salva uma nova versão do escopo (as anteriores ficam no histórico). Faixa e prazo respeitam os
   * limites configurados pelo Admin.
   */
  saveScope(scope: Scope, adminId: string, limits: ScopeLimits, now: Date): number {
    this.transition('saveScope');
    if (scope.priceRange.minCents < limits.minPriceCents)
      throw new ScopeRuleError(
        `A faixa deve começar em pelo menos R$ ${(limits.minPriceCents / 100).toLocaleString('pt-BR')}.`,
      );
    if (scope.deadlineDays > limits.maxDeadlineDays)
      throw new ScopeRuleError(`O prazo máximo é de ${limits.maxDeadlineDays} dias.`);

    const version = this.props.scopeVersion + 1;
    const saved = structuredClone({ ...scope, requiredStacks: [...new Set(scope.requiredStacks)] });
    this.props.scope = saved;
    this.props.scopeVersion = version;
    this.props.updatedAt = now;
    this.newScopeVersions.push({ version, scope: saved, createdBy: adminId, createdAt: now });
    this.record(ProjectEvents.ScopeSaved, now, { projectId: this.id, version });
    return version;
  }

  /**
   * Aprova exatamente a versão que o especialista revisou: se outra versão foi salva depois
   * (outra aba, outro Admin), a aprovação é recusada.
   */
  approveScope(version: number, adminId: string, now: Date): void {
    if (this.props.scopeVersion > 0 && version !== this.props.scopeVersion)
      throw new StaleScopeVersionError(this.props.scopeVersion);
    this.transition('approveScope');
    const scope = this.props.scope!;
    this.props.scopeApprovedAt = now;
    this.props.scopeApprovedBy = adminId;
    this.props.updatedAt = now;
    this.record(ProjectEvents.ScopeApproved, now, {
      projectId: this.id,
      clientId: this.props.clientId,
      version,
      levelSlug: scope.levelSlug,
      type: scope.type,
      requiredStacks: scope.requiredStacks,
    });
  }

  reject(reason: string, now: Date): void {
    this.transition('reject');
    this.props.rejectionReason = reason;
    this.props.rejectedAt = now;
    this.props.updatedAt = now;
    this.record(ProjectEvents.Rejected, now, {
      projectId: this.id,
      clientId: this.props.clientId,
    });
  }

  /** Volta o escopo aprovado para edição (só antes de a distribuição começar). */
  reopenScope(now: Date): void {
    this.transition('reopenScope');
    this.props.scopeApprovedAt = null;
    this.props.scopeApprovedBy = null;
    this.props.updatedAt = now;
    this.record(ProjectEvents.ScopeReopened, now, { projectId: this.id });
  }

  /** A fila abriu a rodada de convites (chamado pelo módulo de distribuição). */
  startDistribution(now: Date): void {
    this.transition('startDistribution');
    this.props.updatedAt = now;
    this.record(ProjectEvents.DistributionStarted, now, { projectId: this.id });
  }

  /** A fila do nível esgotou sem nenhuma proposta: alerta para o especialista. */
  exhaustCandidates(now: Date): void {
    this.transition('exhaustCandidates');
    this.props.updatedAt = now;
    this.record(ProjectEvents.NoCandidates, now, {
      projectId: this.id,
      levelSlug: this.props.scope?.levelSlug ?? null,
    });
  }

  /** O cliente escolheu uma proposta; a contratação segue com o pagamento (F6). */
  hire(invitationId: string, now: Date): void {
    this.transition('hire');
    this.props.updatedAt = now;
    this.record(ProjectEvents.HiringStarted, now, {
      projectId: this.id,
      clientId: this.props.clientId,
      invitationId,
    });
  }

  /** Pagamento em custódia: o trabalho começa. */
  startWork(now: Date): void {
    this.transition('startWork');
    this.props.updatedAt = now;
    this.record(ProjectEvents.WorkStarted, now, { projectId: this.id });
  }

  /** O pagamento não veio no prazo: o cliente volta a escolher entre as propostas. */
  revertHiring(now: Date): void {
    this.transition('revertHiring');
    this.props.updatedAt = now;
    this.record(ProjectEvents.HiringReverted, now, { projectId: this.id });
  }

  /** Entrega final aprovada: o projeto está concluído. */
  complete(now: Date): void {
    this.transition('complete');
    this.props.updatedAt = now;
    this.record(ProjectEvents.Completed, now, { projectId: this.id });
  }

  closeByDispute(now: Date): void {
    this.transition('closeByDispute');
    this.props.updatedAt = now;
    this.record(ProjectEvents.ClosedByDispute, now, { projectId: this.id });
  }

  /** Versões novas desde a última gravação; o repositório as insere no histórico. */
  pullNewScopeVersions(): ScopeVersionRecord[] {
    const versions = this.newScopeVersions;
    this.newScopeVersions = [];
    return versions;
  }

  cancel(reason: string | null, now: Date): void {
    this.transition('cancel');
    this.props.cancelReason = reason;
    this.props.cancelledAt = now;
    this.props.updatedAt = now;
    this.record(ProjectEvents.Cancelled, now, {
      projectId: this.id,
      clientId: this.props.clientId,
    });
  }

  toSnapshot(): ProjectSnapshot {
    return { ...structuredClone(this.props), id: this.id, version: this.version };
  }

  private transition(event: ProjectEvent): void {
    const result = projectMachine.transition(this.props.status, event, {
      alreadyAsked: this.props.clarification !== null,
      hasScope: this.props.scopeVersion > 0,
    });
    if (!result.ok) throw result.error;
    this.props.status = result.value;
  }
}

const answerText = (question: ClarificationQuestion, answers: ClarificationAnswer[]): string => {
  const answer = answers.find((a) => a.questionId === question.id);
  if (!answer) return '(sem resposta)';
  if (answer.other) return answer.other;
  return (
    question.options.find((option) => option.id === answer.optionId)?.label ?? '(sem resposta)'
  );
};
