import type { ClarificationQuestion, Estimate } from '@f4d/contracts';
import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../../../shared/kernel/domain-error.js';
import { InvalidClarificationAnswersError } from './errors.js';
import { Project, ProjectEvents, projectMachine } from './project.js';

const now = new Date('2026-10-01T12:00:00Z');

const submit = () =>
  Project.submit({
    id: 'p1',
    clientId: 'c1',
    title: 'Site da padaria',
    type: 'SITE',
    description: 'Site institucional com cardápio e contato.',
    references: ['https://a.com', 'https://a.com'],
    desiredDeadline: null,
    attachmentIds: [],
    now,
  });

const questions: ClarificationQuestion[] = [
  {
    id: 'q1',
    question: 'Precisa de pedidos online?',
    options: [
      { id: 'a', label: 'Sim' },
      { id: 'b', label: 'Não' },
    ],
    allowOther: false,
  },
  {
    id: 'q2',
    question: 'Quantas páginas?',
    options: [
      { id: 'a', label: 'Até 5' },
      { id: 'b', label: 'Mais de 5' },
    ],
    allowOther: true,
  },
];

const estimate: Estimate = {
  summary: 'Site institucional simples.',
  priceRange: { minCents: 150_000, maxCents: 400_000 },
  durationDays: { min: 10, max: 20 },
  features: ['Cardápio'],
  assumptions: [],
  suggestedType: 'SITE',
  complexity: 'LOW',
  suggestedLevel: 'iniciante',
  suggestedStacks: [],
  risks: [],
  reviewNotes: [],
};

describe('Project', () => {
  it('starts estimating and asks the worker for an estimate', () => {
    const project = submit();
    expect(project.status).toBe('ESTIMATING');
    expect(project.toSnapshot().references).toEqual(['https://a.com']);
    expect(project.awaitsEstimate(1)).toBe(true);
    expect(project.brief().allowQuestions).toBe(true);
    expect(project.pullEvents().map((e) => e.type)).toEqual([ProjectEvents.Submitted]);
  });

  it('asks clarifying questions only once, then estimates with the answers', () => {
    const project = submit();
    project.requestClarification(questions, now);
    expect(project.status).toBe('AWAITING_CLARIFICATION');

    project.answerClarifications(
      [
        { questionId: 'q2', other: 'Umas 8 páginas' },
        { questionId: 'q1', optionId: 'b' },
      ],
      now,
    );
    expect(project.status).toBe('ESTIMATING');
    expect(project.estimationRound).toBe(2);
    // O job da primeira rodada, se chegar atrasado, é ignorado.
    expect(project.awaitsEstimate(1)).toBe(false);
    expect(project.brief()).toMatchObject({
      allowQuestions: false,
      clarifications: [
        { question: 'Precisa de pedidos online?', answer: 'Não' },
        { question: 'Quantas páginas?', answer: 'Umas 8 páginas' },
      ],
    });
    expect(() => project.requestClarification(questions, now)).toThrow(InvalidStateTransitionError);

    project.completeEstimate(estimate, now);
    expect(project.status).toBe('SCOPING');
    expect(project.pullEvents().map((e) => e.type)).toEqual([
      ProjectEvents.Submitted,
      ProjectEvents.ClarificationRequested,
      ProjectEvents.ClarificationsAnswered,
      ProjectEvents.EstimateReady,
    ]);
  });

  it('validates the answers against the questions', () => {
    const project = submit();
    project.requestClarification(questions, now);
    const attempt = (answers: Parameters<Project['answerClarifications']>[0]) => () =>
      project.answerClarifications(answers, now);

    expect(attempt([{ questionId: 'q1', optionId: 'a' }])).toThrow('Responda todas');
    expect(
      attempt([
        { questionId: 'q1', optionId: 'z' },
        { questionId: 'q2', optionId: 'a' },
      ]),
    ).toThrow('Opção inválida');
    expect(
      attempt([
        { questionId: 'q1', other: 'talvez' },
        { questionId: 'q2', optionId: 'a' },
      ]),
    ).toThrow(InvalidClarificationAnswersError);
    expect(
      attempt([
        { questionId: 'q1', optionId: 'a' },
        { questionId: 'q1', optionId: 'b' },
        { questionId: 'q2', optionId: 'a' },
      ]),
    ).toThrow('uma única vez');
    expect(
      attempt([
        { questionId: 'q1', optionId: 'a' },
        { questionId: 'q2', optionId: 'a' },
        { questionId: 'q3', optionId: 'a' },
      ]),
    ).toThrow('inexistentes');
    expect(project.status).toBe('AWAITING_CLARIFICATION');
  });

  it('falls back to the specialist when the AI fails', () => {
    const project = submit();
    project.failEstimate(now);
    expect(project.toSnapshot()).toMatchObject({ status: 'SCOPING', estimateFailed: true });
  });

  it('can be cancelled before hiring, but not twice', () => {
    const project = submit();
    project.cancel('Mudei de ideia', now);
    expect(project.toSnapshot()).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Mudei de ideia',
    });
    expect(() => project.cancel(null, now)).toThrow(InvalidStateTransitionError);
    expect(() => project.completeEstimate(estimate, now)).toThrow(InvalidStateTransitionError);
  });

  it('documents its lifecycle as a Mermaid diagram', () => {
    expect(projectMachine.toMermaid()).toBe(
      [
        'stateDiagram-v2',
        '  [*] --> ESTIMATING',
        '  ESTIMATING --> AWAITING_CLARIFICATION: requestClarification',
        '  ESTIMATING --> SCOPING: completeEstimate',
        '  ESTIMATING --> SCOPING: failEstimate',
        '  ESTIMATING --> CANCELLED: cancel',
        '  AWAITING_CLARIFICATION --> ESTIMATING: answerClarifications',
        '  AWAITING_CLARIFICATION --> CANCELLED: cancel',
        '  SCOPING --> CANCELLED: cancel',
        '  CANCELLED --> [*]',
      ].join('\n'),
    );
  });
});
