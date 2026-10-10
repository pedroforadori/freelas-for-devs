import type { ContractStatus } from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';
import { defineStateMachine } from '../../../shared/kernel/state-machine.js';
import type { ContractAmounts } from './commission.js';

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
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

type ContractEvent = 'fund' | 'expire' | 'cancel';

/** Contratação (docs/architecture.md §4.3); entregas e liberação estendem esta máquina na F7. */
export const contractMachine = defineStateMachine<ContractStatus, ContractEvent>({
  name: 'Contract',
  initial: 'AWAITING_PAYMENT',
  terminal: ['EXPIRED', 'CANCELLED'],
  transitions: {
    AWAITING_PAYMENT: { fund: 'FUNDED', expire: 'EXPIRED', cancel: 'CANCELLED' },
    FUNDED: {},
    EXPIRED: {},
    CANCELLED: {},
  },
});

export const ContractEvents = {
  Created: 'contracts.ContractCreated',
  Funded: 'contracts.ContractFunded',
  Expired: 'contracts.ContractExpired',
  Cancelled: 'contracts.ContractCancelled',
} as const;

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

  isParticipant(userId: string): boolean {
    return userId === this.props.clientId || userId === this.props.freelancerId;
  }

  /** Pagamento confirmado pelo provedor: o valor está em custódia e o projeto começa. */
  fund(now: Date): void {
    this.transition('fund', now);
    this.props.fundedAt = now;
    this.record(ContractEvents.Funded, now, {
      contractId: this.id,
      projectId: this.props.projectId,
      invitationId: this.props.invitationId,
    });
  }

  /** Prazo de pagamento vencido: a escolha é desfeita e o cliente pode escolher outra proposta. */
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

  toSnapshot(): ContractSnapshot {
    return { ...structuredClone(this.props), id: this.id, version: this.version };
  }

  private transition(event: ContractEvent, now: Date): void {
    const result = contractMachine.transition(this.props.status, event, undefined);
    if (!result.ok) throw result.error;
    this.props.status = result.value;
    this.props.updatedAt = now;
  }
}
