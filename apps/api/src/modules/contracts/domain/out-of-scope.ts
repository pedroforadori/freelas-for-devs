import type { OutOfScopeStatus } from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';
import { defineStateMachine } from '../../../shared/kernel/state-machine.js';
import type { ContractAmounts } from './commission.js';
import { DeliveryRuleError } from './contract.js';

export interface OutOfScopeRuling {
  decision: 'IN_SCOPE' | 'OUT_OF_SCOPE';
  note: string;
  adminId: string;
  decidedAt: Date;
}

export interface OutOfScopeSnapshot {
  id: string;
  contractId: string;
  status: OutOfScopeStatus;
  description: string;
  /** Adicional com a comissão do contrato aplicada (mesma regra de quem paga). */
  amounts: ContractAmounts;
  extraDays: number;
  contestReason: string | null;
  ruling: OutOfScopeRuling | null;
  paymentDeadlineAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

type OutOfScopeEvent =
  | 'accept'
  | 'withdraw'
  | 'contest'
  | 'ruleInScope'
  | 'ruleOutOfScope'
  | 'fund'
  | 'expirePayment'
  | 'close';

/**
 * Fora de escopo (docs/architecture.md §4.4). O freelancer marca o pedido já com valor e prazo
 * adicionais (FLAGGED e EXTRA_PROPOSED viram um passo só). Enquanto pendente, os prazos do
 * contrato ficam pausados. `close` encerra o que estiver pendente quando o contrato acaba.
 */
export const outOfScopeMachine = defineStateMachine<OutOfScopeStatus, OutOfScopeEvent>({
  name: 'OutOfScope',
  initial: 'EXTRA_PROPOSED',
  terminal: ['ACCEPTED_FUNDED', 'WITHDRAWN', 'RULED_IN_SCOPE'],
  transitions: {
    EXTRA_PROPOSED: {
      accept: 'ACCEPTED_AWAITING_PAYMENT',
      withdraw: 'WITHDRAWN',
      contest: 'CONTESTED',
      close: 'WITHDRAWN',
    },
    CONTESTED: {
      ruleInScope: 'RULED_IN_SCOPE',
      ruleOutOfScope: 'EXTRA_PROPOSED',
      close: 'WITHDRAWN',
    },
    ACCEPTED_AWAITING_PAYMENT: {
      fund: 'ACCEPTED_FUNDED',
      withdraw: 'WITHDRAWN',
      expirePayment: 'WITHDRAWN',
      close: 'WITHDRAWN',
    },
    ACCEPTED_FUNDED: {},
    WITHDRAWN: {},
    RULED_IN_SCOPE: {},
  },
});

export const OutOfScopeEvents = {
  Flagged: 'contracts.OutOfScopeFlagged',
  Contested: 'contracts.OutOfScopeContested',
  Ruled: 'contracts.OutOfScopeRuled',
} as const;

export class OutOfScopeRequest extends AggregateRoot {
  protected readonly aggregateType = 'OutOfScopeRequest';

  private constructor(
    private props: Omit<OutOfScopeSnapshot, 'id' | 'version'>,
    id: string,
    version: number,
  ) {
    super(id, version);
  }

  static flag(input: {
    id: string;
    contractId: string;
    projectId: string;
    description: string;
    amounts: ContractAmounts;
    extraDays: number;
    now: Date;
  }): OutOfScopeRequest {
    const { id, now, projectId, ...rest } = input;
    const request = new OutOfScopeRequest(
      {
        ...rest,
        status: 'EXTRA_PROPOSED',
        contestReason: null,
        ruling: null,
        paymentDeadlineAt: null,
        createdAt: now,
        updatedAt: now,
      },
      id,
      0,
    );
    request.record(OutOfScopeEvents.Flagged, now, {
      outOfScopeId: id,
      contractId: rest.contractId,
      projectId,
    });
    return request;
  }

  static rehydrate(snapshot: OutOfScopeSnapshot): OutOfScopeRequest {
    const { id, version, ...props } = snapshot;
    return new OutOfScopeRequest(structuredClone(props), id, version);
  }

  get status(): OutOfScopeStatus {
    return this.props.status;
  }
  get contractId(): string {
    return this.props.contractId;
  }
  get amounts(): ContractAmounts {
    return this.props.amounts;
  }
  get extraDays(): number {
    return this.props.extraDays;
  }
  get paymentDeadlineAt(): Date | null {
    return this.props.paymentDeadlineAt;
  }
  get holdKey(): string {
    return `oos:${this.id}`;
  }
  get pending(): boolean {
    return !outOfScopeMachine.isTerminal(this.props.status);
  }

  /** Cliente aceita pagar o adicional (em custódia, até o prazo de pagamento). */
  accept(paymentDeadlineAt: Date, now: Date): void {
    this.apply('accept', now);
    this.props.paymentDeadlineAt = paymentDeadlineAt;
  }

  withdraw(now: Date): void {
    this.apply('withdraw', now);
  }

  contest(reason: string, now: Date): void {
    this.apply('contest', now);
    this.props.contestReason = reason;
    this.record(OutOfScopeEvents.Contested, now, {
      outOfScopeId: this.id,
      contractId: this.props.contractId,
    });
  }

  /** Mediação: dentro do escopo (freelancer faz sem custo) ou fora (cliente aceita ou retira). */
  rule(ruling: Omit<OutOfScopeRuling, 'decidedAt'>, now: Date): void {
    this.apply(ruling.decision === 'IN_SCOPE' ? 'ruleInScope' : 'ruleOutOfScope', now);
    this.props.ruling = { ...ruling, decidedAt: now };
    this.record(OutOfScopeEvents.Ruled, now, {
      outOfScopeId: this.id,
      contractId: this.props.contractId,
      decision: ruling.decision,
    });
  }

  fund(now: Date): void {
    this.apply('fund', now);
  }

  expirePayment(now: Date): void {
    this.apply('expirePayment', now);
  }

  /** Contrato encerrado (decisão da disputa) com o pedido ainda em aberto. */
  close(now: Date): void {
    if (this.pending) this.apply('close', now);
  }

  toSnapshot(): OutOfScopeSnapshot {
    return { ...structuredClone(this.props), id: this.id, version: this.version };
  }

  private apply(event: OutOfScopeEvent, now: Date): void {
    const result = outOfScopeMachine.transition(this.props.status, event, undefined);
    if (!result.ok)
      throw new DeliveryRuleError('Este pedido fora de escopo não pode mais ser alterado assim.');
    this.props.status = result.value;
    this.props.updatedAt = now;
  }
}
