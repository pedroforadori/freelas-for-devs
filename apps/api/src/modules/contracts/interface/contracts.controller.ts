import { Controller, Inject, NotFoundException, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  type AdminContract,
  apiRoutes,
  type Contract as ContractDto,
  type PayoutAccount,
} from '@f4d/contracts';
import type { FastifyRequest } from 'fastify';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { ENV } from '../../../shared/config/config.module.js';
import type { Env } from '../../../shared/config/env.js';
import {
  CurrentPrincipal,
  type Principal,
  RequestContext,
  SkipCsrf,
} from '../../../shared/interface/http/auth/principal.js';
import {
  type ContractRequest,
  ContractRoute,
  ValidRequest,
} from '../../../shared/interface/http/contract-route.js';
import { CONTRACTS_DEPS, type ContractsDeps } from '../application/ports.js';
import {
  HandlePaymentEvent,
  ManagePayoutAccount,
  ReadContracts,
  StartCheckout,
} from '../application/use-cases.js';
import type { Contract } from '../domain/contract.js';

const routes = apiRoutes.contracts;

/** Monta o contrato com nomes e projeto (módulos de identidade e projetos são as fontes). */
class ContractPresenter {
  constructor(
    private readonly deps: ContractsDeps,
    private readonly read: ReadContracts,
  ) {}

  async present(contract: Contract): Promise<ContractDto> {
    const s = contract.toSnapshot();
    const [project, client, freelancer, inProgress] = await Promise.all([
      this.deps.projects.find(s.projectId),
      this.deps.people.find(s.clientId),
      this.deps.people.find(s.freelancerId),
      this.read.hasOpenCheckout(contract),
    ]);
    return {
      id: s.id,
      status: s.status,
      project: {
        id: s.projectId,
        title: project?.title ?? '',
        type: project?.type ?? 'OTHER',
      },
      client: { userId: s.clientId, displayName: client?.displayName ?? '' },
      freelancer: { userId: s.freelancerId, displayName: freelancer?.displayName ?? '' },
      amounts: s.amounts,
      deadlineDays: s.deadlineDays,
      paymentDeadlineAt: s.paymentDeadlineAt.toISOString(),
      fundedAt: s.fundedAt?.toISOString() ?? null,
      paymentInProgress: inProgress,
      createdAt: s.createdAt.toISOString(),
    };
  }
}

@Controller()
export class ContractsController {
  private readonly presenter: ContractPresenter;

  constructor(
    @Inject(CONTRACTS_DEPS) deps: ContractsDeps,
    private readonly read: ReadContracts,
    private readonly checkout: StartCheckout,
    private readonly payouts: ManagePayoutAccount,
  ) {
    this.presenter = new ContractPresenter(deps, read);
  }

  @ContractRoute(routes.getContract)
  async get(
    @ValidRequest() { params }: ContractRequest<typeof routes.getContract>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ContractDto> {
    return this.presenter.present(await this.read.get(principal.userId, params.contractId));
  }

  @ContractRoute(routes.getProjectContract)
  async forProject(
    @ValidRequest() { params }: ContractRequest<typeof routes.getProjectContract>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ContractDto> {
    return this.presenter.present(await this.read.forProject(principal.userId, params.projectId));
  }

  @ContractRoute(routes.startCheckout)
  async startCheckout(
    @ValidRequest() { params }: ContractRequest<typeof routes.startCheckout>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ url: string }> {
    return { url: await this.checkout.execute(principal.userId, params.contractId) };
  }

  @ContractRoute(routes.getMyPayoutAccount)
  myPayoutAccount(@CurrentPrincipal() principal: Principal): Promise<PayoutAccount> {
    return this.payouts.status(principal.userId);
  }

  @ContractRoute(routes.startPayoutOnboarding)
  async onboarding(
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<{ url: string }> {
    return { url: await this.payouts.onboardingUrl(principal.userId, meta) };
  }
}

/**
 * Webhook do provedor: público, sem CSRF (não há navegador) e autenticado pela assinatura sobre o
 * corpo cru. Entregas repetidas são descartadas pela caixa de entrada idempotente.
 */
@Controller()
export class PaymentWebhookController {
  constructor(
    @Inject(CONTRACTS_DEPS) private readonly deps: ContractsDeps,
    private readonly handle: HandlePaymentEvent,
  ) {}

  @ContractRoute(routes.paymentWebhook)
  @SkipCsrf()
  @SkipThrottle()
  async receive(@Req() req: RawBodyRequest<FastifyRequest>): Promise<{ received: true }> {
    const signature = req.headers['stripe-signature'] ?? req.headers['x-fake-signature'];
    const event = this.deps.gateway.parseWebhook(
      req.rawBody ?? Buffer.alloc(0),
      Array.isArray(signature) ? signature[0] : signature,
    );
    await this.handle.execute(event);
    return { received: true };
  }
}

/** Só em desenvolvimento com o provedor simulado: conclui o checkout como se o cliente pagasse. */
@Controller()
export class DevPaymentsController {
  constructor(
    @Inject(CONTRACTS_DEPS) private readonly deps: ContractsDeps,
    @Inject(ENV) private readonly env: Env,
    private readonly handle: HandlePaymentEvent,
  ) {}

  @ContractRoute(routes.devSimulatePayment)
  async simulate(
    @ValidRequest() { body }: ContractRequest<typeof routes.devSimulatePayment>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ received: true }> {
    if (this.env.PAYMENTS_PROVIDER !== 'fake' || this.env.NODE_ENV === 'production')
      throw new NotFoundException();
    const payment = await this.deps.payments.findByCheckout('fake', body.checkoutId);
    const contract = payment ? await this.deps.contracts.find(payment.contractId) : null;
    if (!payment || contract?.clientId !== principal.userId) throw new NotFoundException();
    await this.handle.execute(
      body.outcome === 'succeeded'
        ? {
            kind: 'payment.succeeded',
            id: `fake_evt_${body.checkoutId}_${body.outcome}`,
            checkoutId: body.checkoutId,
            paymentRef: `fake_pi_${body.checkoutId}`,
            amountCents: payment.amountCents,
          }
        : {
            kind: 'payment.failed',
            id: `fake_evt_${body.checkoutId}_failed`,
            checkoutId: body.checkoutId,
          },
    );
    return { received: true };
  }
}

@Controller()
export class AdminContractsController {
  private readonly presenter: ContractPresenter;

  constructor(
    @Inject(CONTRACTS_DEPS) deps: ContractsDeps,
    private readonly read: ReadContracts,
  ) {
    this.presenter = new ContractPresenter(deps, read);
  }

  @ContractRoute(routes.adminGetProjectContract)
  async get(
    @ValidRequest() { params }: ContractRequest<typeof routes.adminGetProjectContract>,
  ): Promise<AdminContract> {
    const { contract, payments, ledger, escrowBalanceCents } = await this.read.adminForProject(
      params.projectId,
    );
    return {
      ...(await this.presenter.present(contract)),
      payments: payments.map((payment) => {
        const p = payment.toSnapshot();
        return {
          id: p.id,
          status: p.status,
          amountCents: p.amountCents,
          provider: p.provider,
          providerCheckoutId: p.providerCheckoutId,
          createdAt: p.createdAt.toISOString(),
          succeededAt: p.succeededAt?.toISOString() ?? null,
          refundedAt: p.refundedAt?.toISOString() ?? null,
        };
      }),
      ledger: ledger.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
      escrowBalanceCents,
    };
  }
}
