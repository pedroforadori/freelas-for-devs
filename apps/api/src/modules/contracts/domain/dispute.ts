import type { DisputeReason, DisputeStatus } from '@f4d/contracts';
import { computeSettlement, DISPUTE_LIMITS, type Settlement } from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';
import { defineStateMachine } from '../../../shared/kernel/state-machine.js';
import type { ContractAmounts } from './commission.js';

export { computeSettlement, type Settlement };
import { DeliveryRuleError } from './contract.js';

export type DisputeKind = 'DISPUTE' | 'ABANDONMENT';
export type DisputeParty = 'CLIENT' | 'FREELANCER';

export interface DisputeStatement {
  role: DisputeParty;
  userId: string;
  text: string;
  attachmentIds: string[];
  createdAt: Date;
}

export interface DisputeResolution extends Settlement {
  freelancerShareBps: number;
  note: string;
  adminId: string;
  decidedAt: Date;
}

/** Passos da execução (cada um feito uma única vez, mesmo com novas tentativas). */
export interface DisputeExecution {
  refundedAt: Date | null;
  transferRef: string | null;
  /** O que impede a conclusão agora (ex.: conta de recebimento do freelancer). */
  waitingFor: string | null;
}

export interface DisputeSnapshot {
  id: string;
  contractId: string;
  kind: DisputeKind;
  status: DisputeStatus;
  openedBy: DisputeParty | 'ADMIN';
  openerId: string;
  reason: DisputeReason;
  description: string;
  evidenceDeadlineAt: Date;
  statements: DisputeStatement[];
  resolution: DisputeResolution | null;
  execution: DisputeExecution;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

type DisputeEvent = 'review' | 'withdraw' | 'resolve' | 'close';

/**
 * Disputa (docs/architecture.md §4.5). OPENED e COLLECTING_EVIDENCE viram OPEN (as partes são
 * avisadas ao abrir). A decisão vai direto para EXECUTING; falhas do provedor ficam registradas
 * em `execution.waitingFor` e a execução é repetida até concluir (sem estado de falha à parte).
 */
export const disputeMachine = defineStateMachine<DisputeStatus, DisputeEvent>({
  name: 'Dispute',
  initial: 'OPEN',
  terminal: ['WITHDRAWN', 'CLOSED'],
  transitions: {
    OPEN: { review: 'UNDER_REVIEW', withdraw: 'WITHDRAWN', resolve: 'EXECUTING' },
    UNDER_REVIEW: { resolve: 'EXECUTING' },
    EXECUTING: { close: 'CLOSED' },
    WITHDRAWN: {},
    CLOSED: {},
  },
});

export const DisputeEvents = {
  Opened: 'contracts.DisputeOpened',
  Resolved: 'contracts.DisputeResolved',
  Closed: 'contracts.DisputeClosed',
} as const;

export class Dispute extends AggregateRoot {
  protected readonly aggregateType = 'Dispute';

  private constructor(
    private props: Omit<DisputeSnapshot, 'id' | 'version'>,
    id: string,
    version: number,
  ) {
    super(id, version);
  }

  static open(input: {
    id: string;
    contractId: string;
    projectId: string;
    kind: DisputeKind;
    openedBy: DisputeParty | 'ADMIN';
    openerId: string;
    reason: DisputeReason;
    description: string;
    evidenceDeadlineAt: Date;
    now: Date;
  }): Dispute {
    const { id, now, projectId, ...rest } = input;
    const dispute = new Dispute(
      {
        ...rest,
        status: 'OPEN',
        statements: [],
        resolution: null,
        execution: { refundedAt: null, transferRef: null, waitingFor: null },
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      id,
      0,
    );
    dispute.record(DisputeEvents.Opened, now, {
      disputeId: id,
      contractId: rest.contractId,
      projectId,
      kind: rest.kind,
      openedBy: rest.openedBy,
    });
    return dispute;
  }

  static rehydrate(snapshot: DisputeSnapshot): Dispute {
    const { id, version, ...props } = snapshot;
    return new Dispute(structuredClone(props), id, version);
  }

  get status(): DisputeStatus {
    return this.props.status;
  }
  get kind(): DisputeKind {
    return this.props.kind;
  }
  get contractId(): string {
    return this.props.contractId;
  }
  get openedBy(): DisputeParty | 'ADMIN' {
    return this.props.openedBy;
  }
  get resolution(): DisputeResolution | null {
    return this.props.resolution;
  }
  get execution(): DisputeExecution {
    return this.props.execution;
  }
  get active(): boolean {
    return !disputeMachine.isTerminal(this.props.status);
  }

  /** Versão de uma das partes (texto e arquivos), enquanto a disputa recebe manifestações. */
  addStatement(statement: Omit<DisputeStatement, 'createdAt'>, now: Date): void {
    if (this.props.status !== 'OPEN')
      throw new DeliveryRuleError('A disputa já está em análise: não recebe novas manifestações.');
    const own = this.props.statements.filter((item) => item.role === statement.role);
    if (own.length >= DISPUTE_LIMITS.statementsPerParty)
      throw new DeliveryRuleError(
        `Cada parte pode enviar até ${DISPUTE_LIMITS.statementsPerParty} manifestações.`,
      );
    this.props.statements.push({ ...statement, createdAt: now });
    this.props.updatedAt = now;
    this.startReviewIfReady(now);
  }

  /** Prazo de manifestação vencido ou as duas partes já falaram: vai para a análise. */
  startReviewIfReady(now: Date): boolean {
    if (this.props.status !== 'OPEN') return false;
    const roles = new Set(this.props.statements.map((item) => item.role));
    const bothSpoke = roles.has('CLIENT') && roles.has('FREELANCER');
    if (!bothSpoke && this.props.evidenceDeadlineAt > now) return false;
    this.apply('review', now);
    return true;
  }

  /** Só quem abriu, antes da análise; abandono não se retira (a custódia precisa de decisão). */
  withdraw(userId: string, now: Date): void {
    if (this.props.openerId !== userId || this.props.kind === 'ABANDONMENT')
      throw new DeliveryRuleError('Só quem abriu a disputa pode retirá-la.');
    if (this.props.status !== 'OPEN')
      throw new DeliveryRuleError('A disputa já está em análise e não pode mais ser retirada.');
    this.apply('withdraw', now);
    this.props.closedAt = now;
  }

  resolve(
    input: { adminId: string; freelancerShareBps: number; note: string; amounts: ContractAmounts },
    now: Date,
  ): DisputeResolution {
    this.apply('resolve', now);
    const resolution: DisputeResolution = {
      ...computeSettlement(input.amounts, input.freelancerShareBps),
      freelancerShareBps: input.freelancerShareBps,
      note: input.note,
      adminId: input.adminId,
      decidedAt: now,
    };
    this.props.resolution = resolution;
    this.record(DisputeEvents.Resolved, now, {
      disputeId: this.id,
      contractId: this.props.contractId,
      freelancerShareBps: input.freelancerShareBps,
    });
    return resolution;
  }

  markRefunded(now: Date): void {
    this.props.execution.refundedAt = now;
    this.props.updatedAt = now;
  }

  markTransferred(transferRef: string, now: Date): void {
    this.props.execution.transferRef = transferRef;
    this.props.updatedAt = now;
  }

  waitFor(reason: string | null, now: Date): void {
    this.props.execution.waitingFor = reason;
    this.props.updatedAt = now;
  }

  /** Execução concluída quando reembolso e repasse que eram devidos foram feitos. */
  get executed(): boolean {
    const r = this.props.resolution;
    if (!r) return false;
    const e = this.props.execution;
    return (
      (r.refundCents === 0 || e.refundedAt !== null) &&
      (r.freelancerCents === 0 || e.transferRef !== null)
    );
  }

  close(now: Date): void {
    this.apply('close', now);
    this.props.execution.waitingFor = null;
    this.props.closedAt = now;
    this.record(DisputeEvents.Closed, now, {
      disputeId: this.id,
      contractId: this.props.contractId,
    });
  }

  toSnapshot(): DisputeSnapshot {
    return { ...structuredClone(this.props), id: this.id, version: this.version };
  }

  private apply(event: DisputeEvent, now: Date): void {
    const result = disputeMachine.transition(this.props.status, event, undefined);
    if (!result.ok) throw new DeliveryRuleError('A disputa não está numa etapa que permita isso.');
    this.props.status = result.value;
    this.props.updatedAt = now;
  }
}
