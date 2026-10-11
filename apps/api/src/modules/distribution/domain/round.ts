import type {
  InvitationStatus,
  ProjectType,
  ProposalInput,
  SelectionFeedbackReason,
} from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';
import { HOUR_MS } from '../../../shared/kernel/clock.js';
import { InvalidStateTransitionError } from '../../../shared/kernel/domain-error.js';
import { InvitationNotFoundError, ProposalOutOfScopeError } from './errors.js';
import { Invitation, type InvitationProps } from './invitation.js';
import type { LostTurnReason } from './queue-entry.js';

export type RoundStatus = 'OPEN' | 'SELECTED' | 'EXHAUSTED' | 'CLOSED' | 'CANCELLED';

/** Parâmetros copiados das configurações e do escopo na abertura (snapshot). */
export interface RoundParams {
  roundSize: number;
  maxInvites: number;
  inviteResponseHours: number;
  maxOpenInvitesPerFreelancer: number;
  roundsBeforeMonitoring: number;
  priceMinCents: number;
  priceMaxCents: number;
  maxDeadlineDays: number;
}

export interface RoundSnapshot {
  id: string;
  projectId: string;
  clientId: string;
  status: RoundStatus;
  levelSlug: string;
  projectType: ProjectType;
  requiredStacks: string[];
  params: RoundParams;
  openedAt: Date;
  closedAt: Date | null;
  invitations: InvitationProps[];
  version: number;
}

export const RoundEvents = {
  Opened: 'distribution.RoundOpened',
  InvitationCreated: 'distribution.InvitationCreated',
  ProposalSubmitted: 'distribution.ProposalSubmitted',
  ProposalSelected: 'distribution.ProposalSelected',
  SelectionReverted: 'distribution.SelectionReverted',
  Exhausted: 'distribution.RoundExhausted',
  Closed: 'distribution.RoundClosed',
  Cancelled: 'distribution.RoundCancelled',
} as const;

/** Efeito de uma mudança da rodada sobre a fila de um freelancer. */
export type QueueEffect =
  | { kind: 'lostTurn'; freelancerId: string; reason: LostTurnReason }
  | { kind: 'answered'; freelancerId: string }
  | { kind: 'voided'; freelancerId: string; wasAwaitingResponse: boolean }
  | { kind: 'hired'; freelancerId: string }
  | { kind: 'notSelected'; freelancerId: string }
  | { kind: 'compensate'; freelancerId: string };

/**
 * Rodada de distribuição de um projeto (docs/architecture.md §6): mantém até K convites ativos,
 * repõe vagas na hora, respeita o teto total de convites e valida as propostas contra o escopo.
 * Cada operação devolve os efeitos sobre a fila, aplicados pelo caso de uso na mesma transação.
 */
export class DistributionRound extends AggregateRoot {
  protected readonly aggregateType = 'DistributionRound';
  private invitations: Invitation[];

  private constructor(
    private props: Omit<RoundSnapshot, 'id' | 'version' | 'invitations'>,
    invitations: InvitationProps[],
    id: string,
    version: number,
  ) {
    super(id, version);
    this.invitations = invitations.map((invitation) => new Invitation({ ...invitation }));
  }

  static open(input: Omit<RoundSnapshot, 'status' | 'closedAt' | 'invitations' | 'version'>) {
    const { id, ...props } = input;
    const round = new DistributionRound({ ...props, status: 'OPEN', closedAt: null }, [], id, 0);
    round.record(RoundEvents.Opened, input.openedAt, {
      roundId: id,
      projectId: input.projectId,
      levelSlug: input.levelSlug,
    });
    return round;
  }

  static rehydrate(snapshot: RoundSnapshot): DistributionRound {
    const { id, version, invitations, ...props } = snapshot;
    return new DistributionRound(structuredClone(props), invitations, id, version);
  }

  get projectId(): string {
    return this.props.projectId;
  }
  get clientId(): string {
    return this.props.clientId;
  }
  get status(): RoundStatus {
    return this.props.status;
  }
  get levelSlug(): string {
    return this.props.levelSlug;
  }
  get projectType(): ProjectType {
    return this.props.projectType;
  }
  get requiredStacks(): string[] {
    return this.props.requiredStacks;
  }
  get params(): RoundParams {
    return this.props.params;
  }

  /** Freelancers já convidados (nunca recebem um segundo convite do mesmo projeto). */
  get invitedFreelancerIds(): string[] {
    return this.invitations.map((invitation) => invitation.freelancerId);
  }

  /** Vagas a preencher agora: até K ativos, sem ultrapassar o teto total. */
  openSlots(): number {
    if (this.props.status !== 'OPEN') return 0;
    const active = this.invitations.filter((invitation) => invitation.occupiesSlot).length;
    const remainingBudget = this.props.params.maxInvites - this.invitations.length;
    return Math.max(0, Math.min(this.props.params.roundSize - active, remainingBudget));
  }

  hasProposals(): boolean {
    return this.invitations.some((invitation) => invitation.status === 'PROPOSAL_SUBMITTED');
  }

  hasActiveInvitations(): boolean {
    return this.invitations.some((invitation) => invitation.occupiesSlot);
  }

  invite(invitations: { id: string; freelancerId: string }[], now: Date): void {
    this.assertOpen('invite');
    if (invitations.length > this.openSlots())
      throw new InvalidStateTransitionError('DistributionRound', this.props.status, 'invite');
    const deadlineAt = new Date(now.getTime() + this.props.params.inviteResponseHours * HOUR_MS);
    for (const { id, freelancerId } of invitations) {
      this.invitations.push(
        new Invitation({
          id,
          freelancerId,
          status: 'INVITED',
          invitedAt: now,
          deadlineAt,
          respondedAt: null,
          proposal: null,
          feedback: null,
          updatedAt: now,
        }),
      );
      this.record(RoundEvents.InvitationCreated, now, {
        invitationId: id,
        freelancerId,
        projectId: this.props.projectId,
        deadlineAt: deadlineAt.toISOString(),
      });
    }
  }

  decline(invitationId: string, freelancerId: string, now: Date): QueueEffect[] {
    this.ownedBy(invitationId, freelancerId).apply('decline', now);
    return [{ kind: 'lostTurn', freelancerId, reason: 'DECLINED' }];
  }

  /** Convites sem resposta no prazo: perdem a vez (vaga reposta pelo caso de uso). */
  expireOverdue(now: Date): QueueEffect[] {
    const overdue = this.invitations.filter(
      (invitation) => invitation.status === 'INVITED' && invitation.deadlineAt <= now,
    );
    for (const invitation of overdue) invitation.apply('expire', now);
    return overdue.map((invitation) => ({
      kind: 'lostTurn',
      freelancerId: invitation.freelancerId,
      reason: 'EXPIRED',
    }));
  }

  /** Envia (ou edita, antes da escolha) a proposta: valor dentro da faixa e prazo do escopo. */
  submitProposal(
    invitationId: string,
    freelancerId: string,
    input: ProposalInput,
    now: Date,
  ): { effects: QueueEffect[]; first: boolean } {
    const invitation = this.ownedBy(invitationId, freelancerId);
    const { priceMinCents, priceMaxCents, maxDeadlineDays } = this.props.params;
    if (input.amountCents < priceMinCents || input.amountCents > priceMaxCents)
      throw new ProposalOutOfScopeError(
        `O valor precisa estar dentro da faixa aprovada (R$ ${brl(priceMinCents)} a R$ ${brl(priceMaxCents)}).`,
      );
    if (input.deadlineDays > maxDeadlineDays)
      throw new ProposalOutOfScopeError(
        `O prazo máximo deste projeto é de ${maxDeadlineDays} dias.`,
      );

    const first = invitation.status === 'INVITED';
    invitation.apply(first ? 'submitProposal' : 'editProposal', now);
    invitation.setProposal(input, now);
    this.record(RoundEvents.ProposalSubmitted, now, {
      invitationId,
      freelancerId,
      projectId: this.props.projectId,
      first,
    });
    return { effects: first ? [{ kind: 'answered', freelancerId }] : [], first };
  }

  withdraw(invitationId: string, freelancerId: string, now: Date): QueueEffect[] {
    this.ownedBy(invitationId, freelancerId).apply('withdraw', now);
    return [{ kind: 'lostTurn', freelancerId, reason: 'WITHDRAWN' }];
  }

  /**
   * Escolha do cliente: a proposta escolhida aguarda pagamento, as demais ficam em espera (com o
   * feedback opcional) e convites ainda sem resposta são encerrados sem penalidade.
   */
  select(
    invitationId: string,
    feedback: { invitationId: string; reasons: SelectionFeedbackReason[] }[],
    now: Date,
  ): QueueEffect[] {
    this.assertOpen('select');
    const chosen = this.find(invitationId);
    chosen.apply('select', now);
    const reasons = new Map(feedback.map((item) => [item.invitationId, item.reasons]));
    const effects: QueueEffect[] = [];
    for (const invitation of this.invitations) {
      if (invitation === chosen) continue;
      if (invitation.status === 'PROPOSAL_SUBMITTED') {
        invitation.apply('hold', now);
        const given = reasons.get(invitation.id);
        if (given) invitation.setFeedback(given);
      } else if (invitation.status === 'INVITED') {
        invitation.apply('void', now);
        effects.push({
          kind: 'voided',
          freelancerId: invitation.freelancerId,
          wasAwaitingResponse: true,
        });
      }
    }
    this.props.status = 'SELECTED';
    const proposal = chosen.proposal!;
    this.record(RoundEvents.ProposalSelected, now, {
      roundId: this.id,
      projectId: this.props.projectId,
      clientId: this.props.clientId,
      invitationId,
      freelancerId: chosen.freelancerId,
      amountCents: proposal.amountCents,
      deadlineDays: proposal.deadlineDays,
    });
    return effects;
  }

  /**
   * Pagamento não veio no prazo (F6): a escolha é desfeita sem penalizar ninguém — o escolhido
   * ganha prioridade, as propostas em espera voltam a valer e a rodada reabre.
   */
  revertSelection(now: Date): QueueEffect[] {
    if (this.props.status !== 'SELECTED')
      throw new InvalidStateTransitionError('DistributionRound', this.props.status, 'revert');
    const effects: QueueEffect[] = [];
    for (const invitation of this.invitations) {
      if (invitation.status === 'SELECTED_PENDING_PAYMENT') {
        invitation.apply('void', now);
        effects.push({ kind: 'compensate', freelancerId: invitation.freelancerId });
      } else if (invitation.status === 'ON_HOLD') {
        invitation.apply('release', now);
      }
    }
    this.props.status = 'OPEN';
    this.record(RoundEvents.SelectionReverted, now, {
      roundId: this.id,
      projectId: this.props.projectId,
    });
    return effects;
  }

  /** Pagamento confirmado (F6): contrata o escolhido e libera os demais com prioridade. */
  finalize(now: Date): QueueEffect[] {
    if (this.props.status !== 'SELECTED')
      throw new InvalidStateTransitionError('DistributionRound', this.props.status, 'finalize');
    const effects: QueueEffect[] = [];
    for (const invitation of this.invitations) {
      if (invitation.status === 'SELECTED_PENDING_PAYMENT') {
        invitation.apply('hire', now);
        effects.push({ kind: 'hired', freelancerId: invitation.freelancerId });
      } else if (invitation.status === 'ON_HOLD') {
        invitation.apply('notSelect', now);
        effects.push({ kind: 'notSelected', freelancerId: invitation.freelancerId });
      }
    }
    this.close('CLOSED', now, RoundEvents.Closed);
    return effects;
  }

  /**
   * Freelancer suspenso: convites, propostas e esperas dele nesta rodada são anulados (a vaga é
   * reposta por quem chama). Uma escolha já aguardando pagamento fica para o Admin decidir.
   */
  removeFreelancer(freelancerId: string, now: Date): QueueEffect[] {
    if (this.props.status !== 'OPEN' && this.props.status !== 'SELECTED') return [];
    const effects: QueueEffect[] = [];
    for (const invitation of this.invitations) {
      if (invitation.freelancerId !== freelancerId) continue;
      const status: InvitationStatus = invitation.status;
      if (status === 'INVITED' || status === 'PROPOSAL_SUBMITTED' || status === 'ON_HOLD') {
        invitation.apply('void', now);
        effects.push({ kind: 'voided', freelancerId, wasAwaitingResponse: status === 'INVITED' });
      }
    }
    return effects;
  }

  /** Fila do nível sem ninguém elegível e nenhuma proposta: o especialista precisa agir. */
  markExhausted(now: Date): void {
    this.assertOpen('exhaust');
    this.close('EXHAUSTED', now, RoundEvents.Exhausted);
  }

  /** Projeto cancelado: tudo é encerrado; quem já tinha proposta ganha prioridade. */
  cancel(now: Date): QueueEffect[] {
    if (this.props.status !== 'OPEN' && this.props.status !== 'SELECTED') return [];
    const effects: QueueEffect[] = [];
    for (const invitation of this.invitations) {
      const status: InvitationStatus = invitation.status;
      if (status === 'INVITED') {
        invitation.apply('void', now);
        effects.push({
          kind: 'voided',
          freelancerId: invitation.freelancerId,
          wasAwaitingResponse: true,
        });
      } else if (
        status === 'PROPOSAL_SUBMITTED' ||
        status === 'ON_HOLD' ||
        status === 'SELECTED_PENDING_PAYMENT'
      ) {
        invitation.apply('void', now);
        effects.push({ kind: 'compensate', freelancerId: invitation.freelancerId });
      }
    }
    this.close('CANCELLED', now, RoundEvents.Cancelled);
    return effects;
  }

  invitation(invitationId: string): Invitation {
    return this.find(invitationId);
  }

  toSnapshot(): RoundSnapshot {
    return {
      ...structuredClone(this.props),
      id: this.id,
      version: this.version,
      invitations: this.invitations.map((invitation) => invitation.toSnapshot()),
    };
  }

  private close(status: RoundStatus, now: Date, event: string): void {
    this.props.status = status;
    this.props.closedAt = now;
    this.record(event, now, { roundId: this.id, projectId: this.props.projectId });
  }

  private assertOpen(action: string): void {
    if (this.props.status !== 'OPEN')
      throw new InvalidStateTransitionError('DistributionRound', this.props.status, action);
  }

  private find(invitationId: string): Invitation {
    const invitation = this.invitations.find((candidate) => candidate.id === invitationId);
    if (!invitation) throw new InvitationNotFoundError();
    return invitation;
  }

  /** Convite de outro freelancer responde "não encontrado" (não revela que existe). */
  private ownedBy(invitationId: string, freelancerId: string): Invitation {
    const invitation = this.find(invitationId);
    if (invitation.freelancerId !== freelancerId) throw new InvitationNotFoundError();
    return invitation;
  }
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR');
