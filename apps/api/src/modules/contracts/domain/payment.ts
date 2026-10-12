import type { PaymentStatus } from '@f4d/contracts';
import { defineStateMachine } from '../../../shared/kernel/state-machine.js';

export interface PaymentSnapshot {
  id: string;
  contractId: string;
  provider: string;
  providerCheckoutId: string;
  providerPaymentRef: string | null;
  checkoutUrl: string;
  checkoutExpiresAt: Date;
  status: PaymentStatus;
  amountCents: number;
  /** Devolvido ao cliente; igual ao valor = REFUNDED (parcial numa disputa fica SUCCEEDED). */
  refundedCents: number;
  /** Pagamento de um adicional fora de escopo (nulo = valor do contrato). */
  outOfScopeId: string | null;
  succeededAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

type PaymentEvent = 'succeed' | 'fail' | 'expire' | 'refund';

export const paymentMachine = defineStateMachine<PaymentStatus, PaymentEvent>({
  name: 'Payment',
  initial: 'PENDING',
  terminal: ['REFUNDED'],
  transitions: {
    PENDING: { succeed: 'SUCCEEDED', fail: 'FAILED', expire: 'EXPIRED' },
    SUCCEEDED: { refund: 'REFUNDED' },
    // O provedor é a fonte da verdade: um pagamento confirmado depois de fechado localmente
    // (corrida entre o cliente pagar e o checkout ser fechado) é aceito — e reembolsado.
    FAILED: { succeed: 'SUCCEEDED' },
    EXPIRED: { succeed: 'SUCCEEDED' },
    REFUNDED: {},
  },
});

/** Uma tentativa de pagamento do contrato (um checkout no provedor). */
export class Payment {
  private constructor(private props: PaymentSnapshot) {}

  static start(
    input: Omit<
      PaymentSnapshot,
      | 'status'
      | 'succeededAt'
      | 'refundedAt'
      | 'providerPaymentRef'
      | 'updatedAt'
      | 'version'
      | 'refundedCents'
      | 'outOfScopeId'
    > & { outOfScopeId?: string | null },
  ) {
    return new Payment({
      ...input,
      outOfScopeId: input.outOfScopeId ?? null,
      refundedCents: 0,
      status: 'PENDING',
      providerPaymentRef: null,
      succeededAt: null,
      refundedAt: null,
      updatedAt: input.createdAt,
      version: 0,
    });
  }

  static rehydrate(snapshot: PaymentSnapshot): Payment {
    return new Payment({ ...snapshot });
  }

  get id(): string {
    return this.props.id;
  }
  get status(): PaymentStatus {
    return this.props.status;
  }
  get contractId(): string {
    return this.props.contractId;
  }
  get amountCents(): number {
    return this.props.amountCents;
  }
  get providerCheckoutId(): string {
    return this.props.providerCheckoutId;
  }
  get providerPaymentRef(): string | null {
    return this.props.providerPaymentRef;
  }
  get checkoutUrl(): string {
    return this.props.checkoutUrl;
  }
  get outOfScopeId(): string | null {
    return this.props.outOfScopeId;
  }
  /** Quanto ainda pode ser devolvido deste pagamento. */
  get refundableCents(): number {
    return this.props.status === 'SUCCEEDED'
      ? this.props.amountCents - this.props.refundedCents
      : 0;
  }

  /** Checkout ainda utilizável (aberto e com folga antes de expirar). */
  isReusable(now: Date): boolean {
    return (
      this.props.status === 'PENDING' &&
      this.props.checkoutExpiresAt.getTime() - now.getTime() > 5 * 60_000
    );
  }

  succeed(paymentRef: string | null, now: Date): void {
    this.apply('succeed', now);
    this.props.providerPaymentRef = paymentRef;
    this.props.succeededAt = now;
  }

  fail(now: Date): void {
    this.apply('fail', now);
  }

  expire(now: Date): void {
    this.apply('expire', now);
  }

  refund(now: Date): void {
    this.apply('refund', now);
    this.props.refundedCents = this.props.amountCents;
    this.props.refundedAt = now;
  }

  /** Devolução de parte do pagamento (decisão de disputa); o total vira REFUNDED. */
  refundPartially(amountCents: number, now: Date): void {
    if (amountCents <= 0 || amountCents > this.refundableCents)
      throw new RangeError(`Reembolso inválido: ${amountCents} de ${this.refundableCents}.`);
    if (amountCents === this.refundableCents) {
      this.refund(now);
      return;
    }
    this.props.refundedCents += amountCents;
    this.props.refundedAt = now;
    this.props.updatedAt = now;
  }

  toSnapshot(): PaymentSnapshot {
    return { ...this.props };
  }

  private apply(event: PaymentEvent, now: Date): void {
    const result = paymentMachine.transition(this.props.status, event, undefined);
    if (!result.ok) throw result.error;
    this.props.status = result.value;
    this.props.updatedAt = now;
  }
}
