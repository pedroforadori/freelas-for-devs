import Stripe from 'stripe';
import type {
  CheckoutRequest,
  CheckoutSession,
  CheckoutState,
  GatewayEvent,
  PaymentGateway,
} from '../application/ports.js';
import { InvalidWebhookError } from '../domain/errors.js';

export interface StripeGatewayConfig {
  secretKey: string;
  webhookSecret: string;
  /** Meios de pagamento do checkout (ex.: card, pix — conforme habilitado na conta). */
  paymentMethods: string[];
  timeoutMs: number;
  /** Só para testes: cliente HTTP alternativo (ex.: fetch interceptado). */
  httpClient?: ReturnType<typeof Stripe.createFetchHttpClient>;
}

type Session = Stripe.Checkout.Session;

const paymentRefOf = (session: Session): string | null =>
  typeof session.payment_intent === 'string'
    ? session.payment_intent
    : (session.payment_intent?.id ?? null);

/**
 * Stripe Connect, modelo "separate charges and transfers" (ADR-0008): a cobrança cai no saldo da
 * plataforma (custódia) e o repasse ao freelancer é uma transferência posterior (F7). Toda
 * escrita leva chave de idempotência; webhooks são verificados pela assinatura.
 */
export class StripePaymentGateway implements PaymentGateway {
  readonly provider = 'stripe';
  private readonly stripe: Stripe;

  constructor(private readonly config: StripeGatewayConfig) {
    this.stripe = new Stripe(config.secretKey, {
      timeout: config.timeoutMs,
      maxNetworkRetries: 2,
      appInfo: { name: 'Freelas 4 Devs' },
      ...(config.httpClient ? { httpClient: config.httpClient } : {}),
    });
  }

  async createCheckout(request: CheckoutRequest, idempotencyKey: string): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        allowed_payment_method_types: this.config.paymentMethods,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'brl',
              unit_amount: request.amountCents,
              product_data: { name: request.description },
            },
          },
        ],
        ...(request.customerEmail ? { customer_email: request.customerEmail } : {}),
        client_reference_id: request.contractId,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        expires_at: Math.floor(request.expiresAt.getTime() / 1000),
        metadata: { contractId: request.contractId, paymentId: request.paymentId },
        payment_intent_data: {
          // Agrupa cobrança e repasse futuro do mesmo contrato.
          transfer_group: `contract_${request.contractId}`,
          metadata: { contractId: request.contractId, paymentId: request.paymentId },
        },
      },
      { idempotencyKey },
    );
    if (!session.url) throw new Error('Stripe não devolveu a URL do checkout.');
    return {
      providerCheckoutId: session.id,
      url: session.url,
      expiresAt: new Date(session.expires_at * 1000),
    };
  }

  async retrieveCheckout(checkoutId: string): Promise<CheckoutState> {
    const session = await this.stripe.checkout.sessions.retrieve(checkoutId);
    const state: CheckoutState['state'] =
      session.payment_status === 'paid'
        ? 'paid'
        : session.status === 'expired'
          ? 'expired'
          : 'open';
    return { state, paymentRef: paymentRefOf(session), amountCents: session.amount_total ?? 0 };
  }

  async expireCheckout(checkoutId: string): Promise<void> {
    try {
      await this.stripe.checkout.sessions.expire(checkoutId);
    } catch {
      // Já expirado ou concluído: nada a fazer.
    }
  }

  async refund(paymentRef: string, amountCents: number, idempotencyKey: string): Promise<void> {
    await this.stripe.refunds.create(
      { payment_intent: paymentRef, amount: amountCents, reason: 'requested_by_customer' },
      { idempotencyKey },
    );
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): GatewayEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature ?? '',
        this.config.webhookSecret,
      );
    } catch {
      throw new InvalidWebhookError();
    }
    return this.translate(event);
  }

  /** Só os eventos que a plataforma usa; os demais são confirmados e ignorados. */
  private translate(event: Stripe.Event): GatewayEvent {
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      const session = event.data.object;
      // Pix e boleto concluem o checkout antes de o dinheiro chegar: espera o evento assíncrono.
      if (session.payment_status !== 'paid')
        return { kind: 'ignored', id: event.id, type: event.type };
      return {
        kind: 'payment.succeeded',
        id: event.id,
        checkoutId: session.id,
        paymentRef: paymentRefOf(session),
        amountCents: session.amount_total ?? 0,
      };
    }
    if (event.type === 'checkout.session.async_payment_failed')
      return { kind: 'payment.failed', id: event.id, checkoutId: event.data.object.id };
    if (event.type === 'checkout.session.expired')
      return { kind: 'payment.expired', id: event.id, checkoutId: event.data.object.id };
    if (event.type === 'account.updated') {
      const account = event.data.object;
      return {
        kind: 'account.updated',
        id: event.id,
        accountId: account.id,
        detailsSubmitted: account.details_submitted ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
      };
    }
    return { kind: 'ignored', id: event.id, type: event.type };
  }

  async createConnectedAccount(input: { userId: string; email: string }): Promise<string> {
    const account = await this.stripe.accounts.create(
      {
        type: 'express',
        country: 'BR',
        ...(input.email ? { email: input.email } : {}),
        capabilities: { transfers: { requested: true } },
        metadata: { userId: input.userId },
      },
      { idempotencyKey: `account:${input.userId}` },
    );
    return account.id;
  }

  async createOnboardingLink(
    accountId: string,
    urls: { returnUrl: string; refreshUrl: string },
  ): Promise<string> {
    const link = await this.stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: urls.returnUrl,
      refresh_url: urls.refreshUrl,
    });
    return link.url;
  }

  /**
   * Repasse ao freelancer a partir do saldo da plataforma (separate charges and transfers). Falha
   * se o saldo ainda não estiver disponível; o job repete até conseguir.
   */
  async createTransfer(
    input: { amountCents: number; destinationAccountId: string; contractId: string },
    idempotencyKey: string,
  ): Promise<string> {
    const transfer = await this.stripe.transfers.create(
      {
        amount: input.amountCents,
        currency: 'brl',
        destination: input.destinationAccountId,
        transfer_group: `contract_${input.contractId}`,
        metadata: { contractId: input.contractId },
      },
      { idempotencyKey },
    );
    return transfer.id;
  }

  async retrieveAccount(accountId: string) {
    const account = await this.stripe.accounts.retrieve(accountId);
    return {
      detailsSubmitted: account.details_submitted ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
    };
  }
}
