import type {
  ClarificationAnswer,
  ClarificationQuestion,
  DesiredDeadline,
  Estimate,
  ProjectStatus,
  ProjectType,
} from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';
import { defineStateMachine } from '../../../shared/kernel/state-machine.js';
import { InvalidClarificationAnswersError } from './errors.js';

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
  cancelReason: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

type ProjectEvent =
  'requestClarification' | 'answerClarifications' | 'completeEstimate' | 'failEstimate' | 'cancel';

/**
 * Ciclo do projeto até o escopo (docs/architecture.md §4.1). A IA pode pedir esclarecimentos
 * uma única vez: depois das respostas, ela precisa estimar — sem laço de perguntas.
 */
export const projectMachine = defineStateMachine<
  ProjectStatus,
  ProjectEvent,
  { alreadyAsked: boolean }
>({
  name: 'Project',
  initial: 'ESTIMATING',
  terminal: ['CANCELLED'],
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
    SCOPING: { cancel: 'CANCELLED' },
    CANCELLED: {},
  },
});

export const ProjectEvents = {
  Submitted: 'projects.ProjectSubmitted',
  ClarificationRequested: 'projects.ClarificationRequested',
  ClarificationsAnswered: 'projects.ClarificationsAnswered',
  EstimateReady: 'projects.EstimateReady',
  EstimateFailed: 'projects.EstimateFailed',
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
    this.props.updatedAt = now;
    this.record(ProjectEvents.EstimateFailed, now, {
      projectId: this.id,
      clientId: this.props.clientId,
    });
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
