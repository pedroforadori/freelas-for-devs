import type { ClarificationQuestion, Estimate, Scope } from '@f4d/contracts';
import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../../../shared/kernel/domain-error.js';
import {
  InvalidClarificationAnswersError,
  ScopeRuleError,
  StaleScopeVersionError,
} from './errors.js';
import { Project, ProjectEvents, projectMachine } from './project.js';

const now = new Date('2026-10-01T12:00:00Z');

const later = new Date('2026-10-02T12:00:00Z');
const limits = { minPriceCents: 50_000, maxDeadlineDays: 365 };
const scope: Scope = {
  type: 'SITE',
  objective: 'Site institucional da padaria com cardápio e contato.',
  features: ['Cardápio', 'Contato via formulário'],
  screens: ['Início', 'Cardápio', 'Contato'],
  acceptanceCriteria: ['Publicado no domínio do cliente'],
  requiredStacks: ['react', 'react'],
  levelSlug: 'iniciante',
  priceRange: { minCents: 150_000, maxCents: 300_000 },
  deadlineDays: 20,
  notesForFreelancers: null,
};

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

  it('saves versioned scopes and approves exactly the reviewed version', () => {
    const project = submit();
    project.completeEstimate(estimate, now);
    expect(project.toSnapshot().scopingStartedAt).toEqual(now);
    expect(() => project.approveScope(1, 'admin', now)).toThrow('salve uma versão');

    expect(project.saveScope(scope, 'admin', limits, now)).toBe(1);
    expect(project.saveScope({ ...scope, deadlineDays: 25 }, 'admin', limits, now)).toBe(2);
    expect(project.pullNewScopeVersions().map((v) => v.version)).toEqual([1, 2]);

    expect(() => project.approveScope(1, 'admin', now)).toThrow(StaleScopeVersionError);
    project.approveScope(2, 'admin', later);
    expect(project.toSnapshot()).toMatchObject({
      status: 'READY_FOR_QUEUE',
      scopeApprovedAt: later,
      scopeApprovedBy: 'admin',
      scope: { deadlineDays: 25, requiredStacks: ['react'] },
    });
    const approved = project.pullEvents().find((e) => e.type === ProjectEvents.ScopeApproved);
    expect(approved?.payload).toMatchObject({ version: 2, levelSlug: 'iniciante', type: 'SITE' });

    project.reopenScope(later);
    expect(project.toSnapshot()).toMatchObject({ status: 'SCOPING', scopeApprovedAt: null });
    expect(project.saveScope(scope, 'admin', limits, later)).toBe(3);
  });

  it('enforces the configured price floor and deadline ceiling', () => {
    const project = submit();
    project.failEstimate(now);
    const cheap = { ...scope, priceRange: { minCents: 10_000, maxCents: 90_000 } };
    expect(() => project.saveScope(cheap, 'admin', limits, now)).toThrow(ScopeRuleError);
    expect(() => project.saveScope({ ...scope, deadlineDays: 400 }, 'admin', limits, now)).toThrow(
      'O prazo máximo é de 365 dias.',
    );
    expect(project.scopeVersion).toBe(0);
  });

  it('can be rejected while scoping, which is final', () => {
    const project = submit();
    project.completeEstimate(estimate, now);
    project.reject('Pedido fora de desenvolvimento de software.', now);
    expect(project.toSnapshot()).toMatchObject({ status: 'REJECTED', rejectedAt: now });
    expect(() => project.cancel(null, now)).toThrow(InvalidStateTransitionError);
    expect(() => project.saveScope(scope, 'admin', limits, now)).toThrow(
      InvalidStateTransitionError,
    );
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
        '  SCOPING --> SCOPING: saveScope',
        '  SCOPING --> READY_FOR_QUEUE: approveScope',
        '  SCOPING --> REJECTED: reject',
        '  SCOPING --> CANCELLED: cancel',
        '  READY_FOR_QUEUE --> SCOPING: reopenScope',
        '  READY_FOR_QUEUE --> DISTRIBUTING: startDistribution',
        '  READY_FOR_QUEUE --> CANCELLED: cancel',
        '  DISTRIBUTING --> NO_CANDIDATES: exhaustCandidates',
        '  DISTRIBUTING --> HIRING: hire',
        '  DISTRIBUTING --> CANCELLED: cancel',
        '  NO_CANDIDATES --> SCOPING: reopenScope',
        '  NO_CANDIDATES --> CANCELLED: cancel',
        '  HIRING --> CANCELLED: cancel',
        '  REJECTED --> [*]',
        '  CANCELLED --> [*]',
      ].join('\n'),
    );
  });
});
