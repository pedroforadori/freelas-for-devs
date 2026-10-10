import type { InvitationStatus, ProposalInput, SelectionFeedbackReason } from '@f4d/contracts';
import { defineStateMachine } from '../../../shared/kernel/state-machine.js';

type InvitationEvent =
  | 'decline'
  | 'expire'
  | 'submitProposal'
  | 'editProposal'
  | 'withdraw'
  | 'select'
  | 'hold'
  | 'hire'
  | 'notSelect'
  | 'release'
  | 'void';

/** Ciclo do convite e da proposta (docs/architecture.md §4.2). */
export const invitationMachine = defineStateMachine<InvitationStatus, InvitationEvent>({
  name: 'Invitation',
  initial: 'INVITED',
  terminal: ['DECLINED', 'EXPIRED', 'WITHDRAWN', 'HIRED', 'NOT_SELECTED', 'VOIDED'],
  transitions: {
    INVITED: {
      decline: 'DECLINED',
      expire: 'EXPIRED',
      submitProposal: 'PROPOSAL_SUBMITTED',
      void: 'VOIDED',
    },
    PROPOSAL_SUBMITTED: {
      editProposal: 'PROPOSAL_SUBMITTED',
      withdraw: 'WITHDRAWN',
      select: 'SELECTED_PENDING_PAYMENT',
      hold: 'ON_HOLD',
      void: 'VOIDED',
    },
    SELECTED_PENDING_PAYMENT: { hire: 'HIRED', void: 'VOIDED' },
    // Pagamento do escolhido não veio: as propostas em espera voltam a valer.
    ON_HOLD: { notSelect: 'NOT_SELECTED', release: 'PROPOSAL_SUBMITTED', void: 'VOIDED' },
    DECLINED: {},
    EXPIRED: {},
    WITHDRAWN: {},
    HIRED: {},
    NOT_SELECTED: {},
    VOIDED: {},
  },
});

export interface ProposalData extends ProposalInput {
  submittedAt: Date;
  updatedAt: Date;
}

export interface InvitationProps {
  id: string;
  freelancerId: string;
  status: InvitationStatus;
  invitedAt: Date;
  deadlineAt: Date;
  respondedAt: Date | null;
  proposal: ProposalData | null;
  feedback: SelectionFeedbackReason[] | null;
  updatedAt: Date;
}

/** Entidade interna da rodada: só a rodada (agregado) muda o estado dos convites. */
export class Invitation {
  constructor(private props: InvitationProps) {}

  get id(): string {
    return this.props.id;
  }
  get freelancerId(): string {
    return this.props.freelancerId;
  }
  get status(): InvitationStatus {
    return this.props.status;
  }
  get deadlineAt(): Date {
    return this.props.deadlineAt;
  }
  get proposal(): ProposalData | null {
    return this.props.proposal;
  }

  /** Ainda ocupa uma vaga da rodada (aguardando resposta ou com proposta em análise). */
  get occupiesSlot(): boolean {
    return this.props.status === 'INVITED' || this.props.status === 'PROPOSAL_SUBMITTED';
  }

  apply(event: InvitationEvent, now: Date): void {
    const result = invitationMachine.transition(this.props.status, event, undefined);
    if (!result.ok) throw result.error;
    this.props.status = result.value;
    this.props.updatedAt = now;
    if (event === 'decline' || event === 'submitProposal') this.props.respondedAt = now;
  }

  setProposal(input: ProposalInput, now: Date): void {
    this.props.proposal = {
      ...input,
      submittedAt: this.props.proposal?.submittedAt ?? now,
      updatedAt: now,
    };
  }

  setFeedback(reasons: SelectionFeedbackReason[]): void {
    this.props.feedback = [...new Set(reasons)];
  }

  toSnapshot(): InvitationProps {
    return structuredClone(this.props);
  }
}
