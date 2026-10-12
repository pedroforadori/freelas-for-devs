import type { ContractStatus, DeliveryStage } from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';
import { DAY_MS } from '../../../shared/kernel/clock.js';
import { DomainError } from '../../../shared/kernel/domain-error.js';
import { defineStateMachine } from '../../../shared/kernel/state-machine.js';
import type { ContractAmounts } from './commission.js';

export interface DeliveryParams {
  reviewDays: number;
  autoApproveDays: number;
  maxCorrections: number;
}

export type DeliveryOutcome =
  'ADJUSTMENTS' | 'APPROVED' | 'TIMEOUT' | 'CORRECTION' | 'AUTO_APPROVED';

export interface AdjustmentItem {
  id: string;
  text: string;
}

export interface DeliveryRecord {
  number: number;
  submittedAt: Date;
  message: string;
  links: string[];
  attachmentIds: string[];
  reviewDeadlineAt: Date;
  reviewedAt: Date | null;
  outcome: DeliveryOutcome | null;
  adjustments: AdjustmentItem[];
  correction: { adjustmentIds: string[]; note: string | null } | null;
}

export interface ContractSnapshot {
  id: string;
  projectId: string;
  invitationId: string;
  clientId: string;
  freelancerId: string;
  status: ContractStatus;
  amounts: ContractAmounts;
  deadlineDays: number;
  paymentDeadlineAt: Date;
  fundedAt: Date | null;
  closedAt: Date | null;
  stage: DeliveryStage | null;
  dueAt: Date | null;
  deliveryParams: DeliveryParams | null;
  correctionsUsed: number;
  deliveries: DeliveryRecord[];
  approvedAt: Date | null;
  approvalKind: 'CLIENT' | 'AUTO' | null;
  releasedAt: Date | null;
  transferRef: string | null;
  /**
   * Travas que pausam os prazos (`oos:<id>` = pedido fora de escopo pendente, `dispute:<id>`).
   * Quando a última sai, prazo combinado e revisão em curso são estendidos pelo tempo parado.
   */
  holds: string[];
  pausedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

type ContractEvent =
  'fund' | 'expire' | 'cancel' | 'approve' | 'release' | 'dispute' | 'resume' | 'settle';

/**
 * Contrato (docs/architecture.md §4.3). Disputa (inclusive abandono) congela o contrato até a
 * decisão: retirada volta a ACTIVE; decisão executada encerra como SETTLED.
 */
export const contractMachine = defineStateMachine<ContractStatus, ContractEvent>({
  name: 'Contract',
  initial: 'AWAITING_PAYMENT',
  terminal: ['RELEASED', 'SETTLED', 'EXPIRED', 'CANCELLED'],
  transitions: {
    AWAITING_PAYMENT: { fund: 'ACTIVE', expire: 'EXPIRED', cancel: 'CANCELLED' },
    ACTIVE: { approve: 'APPROVED', dispute: 'DISPUTED' },
    DISPUTED: { resume: 'ACTIVE', settle: 'SETTLED' },
    APPROVED: { release: 'RELEASED' },
    RELEASED: {},
    SETTLED: {},
    EXPIRED: {},
    CANCELLED: {},
  },
});

type StageEvent = 'deliver' | 'requestAdjustments' | 'timeout' | 'requestCorrection';

/**
 * Rodadas de entrega dentro do contrato ativo: 1ª entrega completa → lista única de ajustes →
 * 2ª entrega → ajustes residuais → entrega final → aprovação. Sem resposta do cliente no prazo,
 * a revisão avança sem ajustes (e a final é aprovada automaticamente).
 */
export const deliveryMachine = defineStateMachine<DeliveryStage, StageEvent>({
  name: 'Delivery',
  initial: 'WORKING_D1',
  terminal: [],
  transitions: {
    WORKING_D1: { deliver: 'REVIEW_D1' },
    REVIEW_D1: { requestAdjustments: 'WORKING_D2', timeout: 'WORKING_D2' },
    WORKING_D2: { deliver: 'REVIEW_D2' },
    REVIEW_D2: { requestAdjustments: 'WORKING_FINAL', timeout: 'WORKING_FINAL' },
    WORKING_FINAL: { deliver: 'FINAL_REVIEW' },
    FINAL_REVIEW: { requestCorrection: 'WORKING_FINAL' },
  },
});

const REVIEW_STAGES: readonly DeliveryStage[] = ['REVIEW_D1', 'REVIEW_D2', 'FINAL_REVIEW'];

export const ContractEvents = {
  Created: 'contracts.ContractCreated',
  Funded: 'contracts.ContractFunded',
  Expired: 'contracts.ContractExpired',
  Cancelled: 'contracts.ContractCancelled',
  DeliverySubmitted: 'contracts.DeliverySubmitted',
  AdjustmentsRequested: 'contracts.AdjustmentsRequested',
  CorrectionRequested: 'contracts.CorrectionRequested',
  ReviewTimedOut: 'contracts.ReviewTimedOut',
  Approved: 'contracts.ContractApproved',
  Released: 'contracts.ContractReleased',
  Disputed: 'contracts.ContractDisputed',
  Abandoned: 'contracts.ContractAbandoned',
  DisputeWithdrawn: 'contracts.DisputeWithdrawn',
  Settled: 'contracts.ContractSettled',
  ExtraFunded: 'contracts.ExtraFunded',
} as const;

export class DeliveryRuleError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(message: string) {
    super(message);
  }
}

export class NotParticipantError extends DomainError {
  readonly code = 'NOT_FOUND';
  constructor() {
    super('Contrato não encontrado.');
  }
}

export class Contract extends AggregateRoot {
  protected readonly aggregateType = 'Contract';

  private constructor(
    private props: Omit<ContractSnapshot, 'id' | 'version'>,
    id: string,
    version: number,
  ) {
    super(id, version);
  }

  static create(input: {
    id: string;
    projectId: string;
    invitationId: string;
    clientId: string;
    freelancerId: string;
    amounts: ContractAmounts;
    deadlineDays: number;
    paymentDeadlineAt: Date;
    now: Date;
  }): Contract {
    const { id, now, ...rest } = input;
    const contract = new Contract(
      {
        ...rest,
        status: 'AWAITING_PAYMENT',
        fundedAt: null,
        closedAt: null,
        stage: null,
        dueAt: null,
        deliveryParams: null,
        correctionsUsed: 0,
        deliveries: [],
        approvedAt: null,
        approvalKind: null,
        releasedAt: null,
        transferRef: null,
        holds: [],
        pausedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      id,
      0,
    );
    contract.record(ContractEvents.Created, now, {
      contractId: id,
      projectId: rest.projectId,
      clientId: rest.clientId,
      freelancerId: rest.freelancerId,
    });
    return contract;
  }

  static rehydrate(snapshot: ContractSnapshot): Contract {
    const { id, version, ...props } = snapshot;
    return new Contract(structuredClone(props), id, version);
  }

  get status(): ContractStatus {
    return this.props.status;
  }
  get stage(): DeliveryStage | null {
    return this.props.stage;
  }
  get projectId(): string {
    return this.props.projectId;
  }
  get clientId(): string {
    return this.props.clientId;
  }
  get freelancerId(): string {
    return this.props.freelancerId;
  }
  get amounts(): ContractAmounts {
    return this.props.amounts;
  }
  get paymentDeadlineAt(): Date {
    return this.props.paymentDeadlineAt;
  }
  get transferRef(): string | null {
    return this.props.transferRef;
  }
  get paused(): boolean {
    return this.props.pausedAt !== null;
  }
  get dueAt(): Date | null {
    return this.props.dueAt;
  }

  isParticipant(userId: string): boolean {
    return userId === this.props.clientId || userId === this.props.freelancerId;
  }

  /** Entrega em revisão (a última enviada), se houver. */
  get currentDelivery(): DeliveryRecord | null {
    return this.props.deliveries.at(-1) ?? null;
  }

  correctionsLeft(): number {
    return Math.max(
      0,
      (this.props.deliveryParams?.maxCorrections ?? 0) - this.props.correctionsUsed,
    );
  }

  /** Pagamento confirmado: o trabalho começa pela 1ª entrega, com os prazos vigentes (snapshot). */
  fund(params: DeliveryParams, now: Date): void {
    this.transition('fund', now);
    this.props.fundedAt = now;
    this.props.stage = 'WORKING_D1';
    this.props.dueAt = new Date(now.getTime() + this.props.deadlineDays * DAY_MS);
    this.props.deliveryParams = { ...params };
    this.record(ContractEvents.Funded, now, {
      contractId: this.id,
      projectId: this.props.projectId,
      invitationId: this.props.invitationId,
    });
  }

  expire(now: Date): void {
    this.transition('expire', now);
    this.props.closedAt = now;
    this.record(ContractEvents.Expired, now, {
      contractId: this.id,
      projectId: this.props.projectId,
    });
  }

  cancel(now: Date): void {
    this.transition('cancel', now);
    this.props.closedAt = now;
    this.record(ContractEvents.Cancelled, now, {
      contractId: this.id,
      projectId: this.props.projectId,
    });
  }

  /** O freelancer entrega a etapa atual; o cliente tem o prazo de revisão para responder. */
  deliver(
    freelancerId: string,
    input: { message: string; links: string[]; attachmentIds: string[] },
    now: Date,
  ): DeliveryRecord {
    this.assertActive(freelancerId === this.props.freelancerId);
    this.stageTransition('deliver', now);
    const number =
      this.props.stage === 'FINAL_REVIEW' ? 3 : this.props.stage === 'REVIEW_D2' ? 2 : 1;
    const params = this.props.deliveryParams!;
    const days = number === 3 ? params.autoApproveDays : params.reviewDays;
    const delivery: DeliveryRecord = {
      number,
      submittedAt: now,
      message: input.message,
      links: [...new Set(input.links)],
      attachmentIds: [...new Set(input.attachmentIds)],
      reviewDeadlineAt: new Date(now.getTime() + days * DAY_MS),
      reviewedAt: null,
      outcome: null,
      adjustments: [],
      correction: null,
    };
    this.props.deliveries.push(delivery);
    this.record(ContractEvents.DeliverySubmitted, now, {
      contractId: this.id,
      projectId: this.props.projectId,
      number,
      reviewDeadlineAt: delivery.reviewDeadlineAt.toISOString(),
    });
    return delivery;
  }

  /** Lista única de ajustes da revisão (1ª ou 2ª entrega). */
  requestAdjustments(clientId: string, items: { id: string; text: string }[], now: Date): void {
    this.assertActive(clientId === this.props.clientId);
    this.stageTransition('requestAdjustments', now);
    this.closeReview('ADJUSTMENTS', now, { adjustments: items });
    this.record(ContractEvents.AdjustmentsRequested, now, {
      contractId: this.id,
      projectId: this.props.projectId,
      items: items.length,
    });
  }

  /**
   * Correção pontual na entrega final: só de ajustes já pedidos (pedido novo é fora de escopo,
   * F8) e dentro do limite configurado.
   */
  requestCorrection(
    clientId: string,
    adjustmentIds: string[],
    note: string | null,
    now: Date,
  ): void {
    this.assertActive(clientId === this.props.clientId);
    if (this.correctionsLeft() === 0)
      throw new DeliveryRuleError('O limite de correções da entrega final já foi usado.');
    const known = new Set(
      this.props.deliveries.flatMap((delivery) => delivery.adjustments.map((item) => item.id)),
    );
    if (adjustmentIds.some((id) => !known.has(id)))
      throw new DeliveryRuleError(
        'A correção precisa se referir a ajustes já pedidos. Pedidos novos são tratados como fora de escopo.',
      );
    this.stageTransition('requestCorrection', now);
    this.props.correctionsUsed += 1;
    this.closeReview('CORRECTION', now, {
      correction: { adjustmentIds: [...new Set(adjustmentIds)], note },
    });
    this.record(ContractEvents.CorrectionRequested, now, {
      contractId: this.id,
      projectId: this.props.projectId,
    });
  }

  /** Aprovação do cliente em qualquer revisão (inclusive antecipada) ou automática na final. */
  approve(by: 'CLIENT' | 'AUTO', clientId: string | null, now: Date): void {
    if (by === 'CLIENT') this.assertActive(clientId === this.props.clientId);
    if (this.props.holds.some((hold) => hold.startsWith('oos:')))
      throw new DeliveryRuleError(
        'Há um pedido fora de escopo em aberto: resolva-o (aceite, retire ou conteste) antes de aprovar.',
      );
    if (!this.props.stage || !REVIEW_STAGES.includes(this.props.stage))
      throw new DeliveryRuleError('Não há entrega aguardando revisão.');
    this.transition('approve', now);
    this.closeReview(by === 'AUTO' ? 'AUTO_APPROVED' : 'APPROVED', now);
    this.props.stage = null;
    this.props.approvedAt = now;
    this.props.approvalKind = by;
    this.record(ContractEvents.Approved, now, {
      contractId: this.id,
      projectId: this.props.projectId,
      freelancerId: this.props.freelancerId,
      automatic: by === 'AUTO',
    });
  }

  /**
   * Prazo de revisão vencido sem resposta do cliente: 1ª e 2ª avançam sem ajustes; a final é
   * aprovada automaticamente. Retorna o que aconteceu (ou null se ainda não venceu).
   */
  reviewTimeout(now: Date): 'ADVANCED' | 'AUTO_APPROVED' | null {
    const delivery = this.currentDelivery;
    if (this.props.status !== 'ACTIVE' || !delivery || delivery.reviewedAt) return null;
    if (this.props.pausedAt) return null;
    if (delivery.reviewDeadlineAt > now) return null;
    if (this.props.stage === 'FINAL_REVIEW') {
      this.approve('AUTO', null, now);
      return 'AUTO_APPROVED';
    }
    this.stageTransition('timeout', now);
    this.closeReview('TIMEOUT', now);
    this.record(ContractEvents.ReviewTimedOut, now, {
      contractId: this.id,
      projectId: this.props.projectId,
      number: delivery.number,
    });
    return 'ADVANCED';
  }

  /** Repasse ao freelancer concluído no provedor. */
  release(transferRef: string, now: Date): void {
    this.transition('release', now);
    this.props.transferRef = transferRef;
    this.props.releasedAt = now;
    this.props.closedAt = now;
    this.record(ContractEvents.Released, now, {
      contractId: this.id,
      projectId: this.props.projectId,
      freelancerId: this.props.freelancerId,
    });
  }

  /** Pausa os prazos enquanto a trava existir (idempotente por chave). */
  hold(key: string, now: Date): void {
    if (this.props.holds.includes(key)) return;
    if (this.props.holds.length === 0) this.props.pausedAt = now;
    this.props.holds.push(key);
    this.props.updatedAt = now;
  }

  /** Remove a trava; sem nenhuma, os prazos voltam a correr estendidos pelo tempo parado. */
  releaseHold(key: string, now: Date): void {
    if (!this.props.holds.includes(key)) return;
    this.props.holds = this.props.holds.filter((hold) => hold !== key);
    this.props.updatedAt = now;
    if (this.props.holds.length > 0 || !this.props.pausedAt) return;
    const pausedMs = Math.max(0, now.getTime() - this.props.pausedAt.getTime());
    this.props.pausedAt = null;
    if (this.props.dueAt) this.props.dueAt = new Date(this.props.dueAt.getTime() + pausedMs);
    const delivery = this.currentDelivery;
    if (delivery && !delivery.reviewedAt)
      delivery.reviewDeadlineAt = new Date(delivery.reviewDeadlineAt.getTime() + pausedMs);
  }

  /** Adicional fora de escopo pago: soma aos valores em custódia e estende o prazo combinado. */
  addExtra(extra: ContractAmounts, extraDays: number, outOfScopeId: string, now: Date): void {
    if (this.props.status !== 'ACTIVE' && this.props.status !== 'DISPUTED')
      throw new DeliveryRuleError('Este contrato não está em andamento.');
    const a = this.props.amounts;
    this.props.amounts = {
      ...a,
      proposalCents: a.proposalCents + extra.proposalCents,
      platformFeeCents: a.platformFeeCents + extra.platformFeeCents,
      clientTotalCents: a.clientTotalCents + extra.clientTotalCents,
      freelancerNetCents: a.freelancerNetCents + extra.freelancerNetCents,
    };
    if (this.props.dueAt)
      this.props.dueAt = new Date(this.props.dueAt.getTime() + extraDays * DAY_MS);
    this.props.updatedAt = now;
    this.record(ContractEvents.ExtraFunded, now, {
      contractId: this.id,
      projectId: this.props.projectId,
      outOfScopeId,
      clientTotalCents: extra.clientTotalCents,
    });
  }

  /**
   * Disputa aberta (por uma parte ou, no abandono, pelo freelancer/Admin): o contrato congela e
   * os prazos param até a retirada ou a decisão.
   */
  openDispute(disputeId: string, kind: 'DISPUTE' | 'ABANDONMENT', now: Date): void {
    this.transition('dispute', now);
    this.hold(`dispute:${disputeId}`, now);
    const payload = {
      contractId: this.id,
      projectId: this.props.projectId,
      clientId: this.props.clientId,
      freelancerId: this.props.freelancerId,
      disputeId,
    };
    this.record(ContractEvents.Disputed, now, { ...payload, kind });
    if (kind === 'ABANDONMENT') this.record(ContractEvents.Abandoned, now, payload);
  }

  /** Disputa retirada antes da decisão: o trabalho continua de onde parou. */
  resumeAfterDispute(disputeId: string, now: Date): void {
    this.transition('resume', now);
    this.releaseHold(`dispute:${disputeId}`, now);
    this.record(ContractEvents.DisputeWithdrawn, now, {
      contractId: this.id,
      projectId: this.props.projectId,
      disputeId,
    });
  }

  /** Decisão da disputa executada (repasse e/ou reembolso): contrato encerrado. */
  settle(disputeId: string, now: Date): void {
    this.transition('settle', now);
    this.props.stage = null;
    this.props.holds = [];
    this.props.pausedAt = null;
    this.props.closedAt = now;
    this.record(ContractEvents.Settled, now, {
      contractId: this.id,
      projectId: this.props.projectId,
      freelancerId: this.props.freelancerId,
      disputeId,
    });
  }

  toSnapshot(): ContractSnapshot {
    return { ...structuredClone(this.props), id: this.id, version: this.version };
  }

  private closeReview(
    outcome: DeliveryOutcome,
    now: Date,
    extra: Partial<Pick<DeliveryRecord, 'adjustments' | 'correction'>> = {},
  ): void {
    const delivery = this.currentDelivery;
    if (!delivery || delivery.reviewedAt) return;
    Object.assign(delivery, { reviewedAt: now, outcome, ...extra });
  }

  /** Só participantes, e só com o contrato ativo (pago e não aprovado). */
  private assertActive(isParticipant: boolean): void {
    if (!isParticipant) throw new NotParticipantError();
    if (this.props.status !== 'ACTIVE' || !this.props.stage)
      throw new DeliveryRuleError('Este contrato não está em andamento.');
  }

  private stageTransition(event: StageEvent, now: Date): void {
    const result = deliveryMachine.transition(this.props.stage!, event, undefined);
    if (!result.ok) throw result.error;
    this.props.stage = result.value;
    this.props.updatedAt = now;
  }

  private transition(event: ContractEvent, now: Date): void {
    const result = contractMachine.transition(this.props.status, event, undefined);
    if (!result.ok) throw result.error;
    this.props.status = result.value;
    this.props.updatedAt = now;
  }
}
