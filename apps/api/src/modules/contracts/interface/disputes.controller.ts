import { Controller, Inject } from '@nestjs/common';
import {
  type AdminDisputeSummary,
  apiRoutes,
  type Contract as ContractDto,
  type UserContractStats,
} from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import {
  CurrentPrincipal,
  type Principal,
  RequestContext,
} from '../../../shared/interface/http/auth/principal.js';
import {
  type ContractRequest,
  ContractRoute,
  ValidRequest,
} from '../../../shared/interface/http/contract-route.js';
import { ManageDispute, ManageOutOfScope, ReadDisputes } from '../application/disputes.js';
import { CONTRACTS_DEPS, type ContractsDeps } from '../application/ports.js';
import { ReadContracts } from '../application/use-cases.js';
import type { Contract } from '../domain/contract.js';
import { ContractPresenter } from './contracts.controller.js';

const routes = apiRoutes.disputes;

/** Fora de escopo, disputas e abandono pelas partes do contrato (F8). */
@Controller()
export class DisputesController {
  private readonly presenter: ContractPresenter;

  constructor(
    @Inject(CONTRACTS_DEPS) deps: ContractsDeps,
    read: ReadContracts,
    disputes: ReadDisputes,
    private readonly outOfScope: ManageOutOfScope,
    private readonly manage: ManageDispute,
  ) {
    this.presenter = new ContractPresenter(deps, read, disputes);
  }

  private present(contract: Promise<Contract>): Promise<ContractDto> {
    return contract.then((loaded) => this.presenter.present(loaded));
  }

  @ContractRoute(routes.flagOutOfScope)
  flag(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.flagOutOfScope>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ContractDto> {
    return this.present(this.outOfScope.flag(principal.userId, params.contractId, body));
  }

  @ContractRoute(routes.acceptOutOfScope)
  accept(
    @ValidRequest() { params }: ContractRequest<typeof routes.acceptOutOfScope>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ContractDto> {
    return this.present(
      this.outOfScope.accept(principal.userId, params.contractId, params.requestId),
    );
  }

  @ContractRoute(routes.startOutOfScopeCheckout)
  async checkout(
    @ValidRequest() { params }: ContractRequest<typeof routes.startOutOfScopeCheckout>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ url: string }> {
    return {
      url: await this.outOfScope.checkout(principal.userId, params.contractId, params.requestId),
    };
  }

  @ContractRoute(routes.withdrawOutOfScope)
  withdraw(
    @ValidRequest() { params }: ContractRequest<typeof routes.withdrawOutOfScope>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ContractDto> {
    return this.present(
      this.outOfScope.withdraw(principal.userId, params.contractId, params.requestId),
    );
  }

  @ContractRoute(routes.contestOutOfScope)
  contest(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.contestOutOfScope>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ContractDto> {
    return this.present(
      this.outOfScope.contest(principal.userId, params.contractId, params.requestId, body.reason),
    );
  }

  @ContractRoute(routes.openDispute)
  open(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.openDispute>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ContractDto> {
    return this.present(this.manage.open(principal.userId, params.contractId, body));
  }

  @ContractRoute(routes.abandonContract)
  abandon(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.abandonContract>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ContractDto> {
    return this.present(this.manage.abandon(principal.userId, params.contractId, body.description));
  }

  @ContractRoute(routes.addDisputeStatement)
  statement(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.addDisputeStatement>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ContractDto> {
    return this.present(this.manage.addStatement(principal.userId, params.contractId, body));
  }

  @ContractRoute(routes.withdrawDispute)
  withdrawDispute(
    @ValidRequest() { params }: ContractRequest<typeof routes.withdrawDispute>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ContractDto> {
    return this.present(this.manage.withdraw(principal.userId, params.contractId));
  }
}

/** Mediação: contestações de escopo, disputas, abandono declarado e histórico por pessoa. */
@Controller()
export class AdminDisputesController {
  constructor(
    private readonly outOfScope: ManageOutOfScope,
    private readonly manage: ManageDispute,
    private readonly read: ReadDisputes,
  ) {}

  @ContractRoute(routes.adminRuleOutOfScope)
  async rule(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminRuleOutOfScope>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<void> {
    await this.outOfScope.rule(principal.userId, params.contractId, params.requestId, body, meta);
  }

  @ContractRoute(routes.adminListDisputes)
  async list(
    @ValidRequest() { query }: ContractRequest<typeof routes.adminListDisputes>,
  ): Promise<{ items: AdminDisputeSummary[] }> {
    return { items: await this.read.adminList(query.view) };
  }

  @ContractRoute(routes.adminResolveDispute)
  async resolve(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminResolveDispute>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<void> {
    await this.manage.resolve(principal.userId, params.disputeId, body, meta);
  }

  @ContractRoute(routes.adminDeclareAbandonment)
  async declareAbandonment(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminDeclareAbandonment>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<void> {
    await this.manage.declareAbandonment(
      principal.userId,
      params.contractId,
      body.description,
      meta,
    );
  }

  @ContractRoute(routes.adminUserContractStats)
  stats(
    @ValidRequest() { params }: ContractRequest<typeof routes.adminUserContractStats>,
  ): Promise<UserContractStats> {
    return this.read.stats(params.userId);
  }
}
