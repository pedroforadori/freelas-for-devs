import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { InvalidWebhookError } from '../domain/errors.js';
import { StripePaymentGateway } from './stripe-gateway.js';

const WEBHOOK_SECRET = 'whsec_test_secret';

/** SDK real do Stripe com o HTTP interceptado: confere o que seria enviado à API. */
const gatewayWith = (respond: (url: string, body: URLSearchParams) => unknown) => {
  const calls: { url: string; headers: Headers; body: URLSearchParams }[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = new URLSearchParams(await request.text());
    calls.push({ url: request.url, headers: request.headers, body });
    return Response.json(respond(request.url, body));
  });
  const gateway = new StripePaymentGateway({
    secretKey: 'sk_test_123',
    webhookSecret: WEBHOOK_SECRET,
    paymentMethods: ['card', 'pix'],
    timeoutMs: 5_000,
    httpClient: Stripe.createFetchHttpClient(fetchFn),
  });
  return { gateway, calls };
};

const signed = (event: Record<string, unknown>) => {
  const payload = JSON.stringify(event);
  return {
    body: Buffer.from(payload),
    signature: Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
  };
};

const sessionEvent = (type: string, session: Record<string, unknown>) => ({
  id: `evt_${type}`,
  object: 'event',
  type,
  data: {
    object: { id: 'cs_test_1', object: 'checkout.session', amount_total: 330_000, ...session },
  },
});

describe('StripePaymentGateway', () => {
  it('creates a checkout charged to the platform (escrow), with idempotency key', async () => {
    const { gateway, calls } = gatewayWith(() => ({
      id: 'cs_test_1',
      object: 'checkout.session',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      expires_at: 1_800_000_000,
    }));
    const session = await gateway.createCheckout(
      {
        paymentId: 'pay-1',
        contractId: 'ctr-1',
        amountCents: 330_000,
        description: 'Site da padaria',
        customerEmail: 'ana@exemplo.com',
        successUrl: 'https://app.test/projetos/p1?pagamento=confirmando',
        cancelUrl: 'https://app.test/projetos/p1',
        expiresAt: new Date(1_800_000_000_000),
      },
      'checkout:pay-1',
    );
    expect(session).toEqual({
      providerCheckoutId: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      expiresAt: new Date(1_800_000_000_000),
    });
    const [call] = calls;
    expect(call?.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(call?.headers.get('idempotency-key')).toBe('checkout:pay-1');
    const body = Object.fromEntries(call?.body ?? []);
    expect(body).toMatchObject({
      mode: 'payment',
      'line_items[0][price_data][currency]': 'brl',
      'line_items[0][price_data][unit_amount]': '330000',
      'allowed_payment_method_types[0]': 'card',
      'allowed_payment_method_types[1]': 'pix',
      'payment_intent_data[transfer_group]': 'contract_ctr-1',
      'metadata[contractId]': 'ctr-1',
      expires_at: '1800000000',
    });
    // Separate charges and transfers: nada de transfer_data/destination na cobrança.
    expect(Object.keys(body).some((key) => key.includes('transfer_data'))).toBe(false);
  });

  it('accepts only webhooks signed with the endpoint secret', () => {
    const { gateway } = gatewayWith(() => ({}));
    const event = signed(
      sessionEvent('checkout.session.completed', {
        payment_status: 'paid',
        payment_intent: 'pi_1',
      }),
    );
    expect(gateway.parseWebhook(event.body, event.signature)).toEqual({
      kind: 'payment.succeeded',
      id: 'evt_checkout.session.completed',
      checkoutId: 'cs_test_1',
      paymentRef: 'pi_1',
      amountCents: 330_000,
    });
    expect(() => gateway.parseWebhook(event.body, 't=1,v1=forjada')).toThrow(InvalidWebhookError);
    const tampered = Buffer.from(event.body.toString().replace('330000', '1'));
    expect(() => gateway.parseWebhook(tampered, event.signature)).toThrow(InvalidWebhookError);
  });

  it('waits for the async confirmation of Pix and translates expiry and account updates', () => {
    const { gateway } = gatewayWith(() => ({}));
    const parse = (event: Record<string, unknown>) => {
      const { body, signature } = signed(event);
      return gateway.parseWebhook(body, signature);
    };
    expect(
      parse(sessionEvent('checkout.session.completed', { payment_status: 'unpaid' })),
    ).toMatchObject({
      kind: 'ignored',
    });
    expect(
      parse(sessionEvent('checkout.session.async_payment_succeeded', { payment_status: 'paid' })),
    ).toMatchObject({ kind: 'payment.succeeded', checkoutId: 'cs_test_1' });
    expect(parse(sessionEvent('checkout.session.expired', {}))).toMatchObject({
      kind: 'payment.expired',
    });
    expect(
      parse({
        id: 'evt_acct',
        object: 'event',
        type: 'account.updated',
        data: {
          object: {
            id: 'acct_1',
            object: 'account',
            details_submitted: true,
            payouts_enabled: false,
          },
        },
      }),
    ).toEqual({
      kind: 'account.updated',
      id: 'evt_acct',
      accountId: 'acct_1',
      detailsSubmitted: true,
      payoutsEnabled: false,
    });
    expect(
      parse({ id: 'evt_x', object: 'event', type: 'charge.updated', data: { object: {} } }),
    ).toEqual({
      kind: 'ignored',
      id: 'evt_x',
      type: 'charge.updated',
    });
  });

  it('creates Express connected accounts in Brazil for freelancers', async () => {
    const { gateway, calls } = gatewayWith((url) =>
      url.endsWith('/accounts')
        ? { id: 'acct_1', object: 'account' }
        : { url: 'https://connect.stripe.com/setup/x' },
    );
    expect(await gateway.createConnectedAccount({ userId: 'u1', email: 'dev@exemplo.com' })).toBe(
      'acct_1',
    );
    expect(Object.fromEntries(calls[0]?.body ?? [])).toMatchObject({
      type: 'express',
      country: 'BR',
      'capabilities[transfers][requested]': 'true',
    });
    expect(calls[0]?.headers.get('idempotency-key')).toBe('account:u1');
  });
});
