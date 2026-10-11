import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type {
  CheckoutRequest,
  CheckoutSession,
  CheckoutState,
  GatewayEvent,
  PaymentGateway,
} from '../application/ports.js';
import { InvalidWebhookError } from '../domain/errors.js';

const fakeEventSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('payment.succeeded'),
    checkoutId: z.string(),
    amountCents: z.number().int(),
  }),
  z.object({ id: z.string(), type: z.literal('payment.failed'), checkoutId: z.string() }),
  z.object({ id: z.string(), type: z.literal('payment.expired'), checkoutId: z.string() }),
]);

/**
 * Provedor simulado (PAYMENTS_PROVIDER=fake) para desenvolvimento e testes, sem conta Stripe:
 * o "checkout" é uma página do próprio web que dispara o webhook simulado. Proibido em produção.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly provider = 'fake';
  readonly refunds: { paymentRef: string; amountCents: number; idempotencyKey: string }[] = [];
  readonly expired = new Set<string>();
  private counter = 0;

  constructor(
    private readonly webAppUrl: string,
    private readonly webhookSecret: string,
  ) {}

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const id = `fake_cs_${request.paymentId}`;
    return Promise.resolve({
      providerCheckoutId: id,
      url: `${this.webAppUrl}/pagamento-simulado?${new URLSearchParams({
        checkout: id,
        valor: String(request.amountCents),
        retorno: request.successUrl,
      }).toString()}`,
      expiresAt: request.expiresAt,
    });
  }

  retrieveCheckout(checkoutId: string): Promise<CheckoutState> {
    return Promise.resolve({
      state: this.expired.has(checkoutId) ? 'expired' : 'open',
      paymentRef: null,
      amountCents: 0,
    });
  }

  expireCheckout(checkoutId: string): Promise<void> {
    this.expired.add(checkoutId);
    return Promise.resolve();
  }

  refund(paymentRef: string, amountCents: number, idempotencyKey: string): Promise<void> {
    if (!this.refunds.some((r) => r.idempotencyKey === idempotencyKey))
      this.refunds.push({ paymentRef, amountCents, idempotencyKey });
    return Promise.resolve();
  }

  /** Assinatura simulada: o header precisa ser exatamente o segredo configurado. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): GatewayEvent {
    const expected = Buffer.from(this.webhookSecret);
    const given = Buffer.from(signature ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new InvalidWebhookError();
    const parsed = fakeEventSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
    if (!parsed.success) throw new InvalidWebhookError();
    const event = parsed.data;
    if (event.type === 'payment.succeeded') {
      return {
        kind: 'payment.succeeded',
        id: event.id,
        checkoutId: event.checkoutId,
        paymentRef: `fake_pi_${event.checkoutId}`,
        amountCents: event.amountCents,
      };
    }
    return { kind: event.type, id: event.id, checkoutId: event.checkoutId };
  }

  createConnectedAccount(input: { userId: string }): Promise<string> {
    return Promise.resolve(`fake_acct_${input.userId}`);
  }

  createOnboardingLink(_accountId: string, urls: { returnUrl: string }): Promise<string> {
    this.counter += 1;
    return Promise.resolve(urls.returnUrl);
  }

  readonly transfers: { amountCents: number; destinationAccountId: string; contractId: string }[] =
    [];

  createTransfer(input: { amountCents: number; destinationAccountId: string; contractId: string }) {
    if (!this.transfers.some((t) => t.contractId === input.contractId)) this.transfers.push(input);
    return Promise.resolve(`fake_tr_${input.contractId}`);
  }

  /** No simulador, o cadastro de recebimento fica pronto assim que é criado. */
  retrieveAccount(): Promise<{ detailsSubmitted: boolean; payoutsEnabled: boolean }> {
    return Promise.resolve({ detailsSubmitted: true, payoutsEnabled: true });
  }
}
