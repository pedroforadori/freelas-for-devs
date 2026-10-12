import { Controller } from '@nestjs/common';
import {
  apiRoutes,
  type LevelWithRule,
  type PromotionSuggestion,
  type Reputation,
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
import { ManageLevelRules, ReadReputation, RecomputeReputation } from '../application/use-cases.js';

const routes = apiRoutes.reputation;

@Controller()
export class ReputationController {
  constructor(private readonly read: ReadReputation) {}

  @ContractRoute(routes.getMyReputation)
  mine(@CurrentPrincipal() principal: Principal): Promise<Reputation> {
    return this.read.forFreelancer(principal.userId);
  }
}

@Controller()
export class AdminReputationController {
  constructor(
    private readonly read: ReadReputation,
    private readonly rules: ManageLevelRules,
    private readonly recompute: RecomputeReputation,
  ) {}

  @ContractRoute(routes.adminFreelancerReputation)
  freelancer(
    @ValidRequest() { params }: ContractRequest<typeof routes.adminFreelancerReputation>,
  ): Promise<Reputation> {
    return this.read.forFreelancer(params.userId);
  }

  @ContractRoute(routes.adminListLevels)
  async levels(): Promise<{ items: LevelWithRule[] }> {
    return { items: await this.read.levels() };
  }

  @ContractRoute(routes.adminUpdatePromotionRule)
  async updateRule(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminUpdatePromotionRule>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<void> {
    await this.rules.update(principal.userId, params.slug, body.promotion, meta);
  }

  @ContractRoute(routes.adminPromotionSuggestions)
  async suggestions(): Promise<{ items: PromotionSuggestion[] }> {
    return { items: await this.read.suggestions() };
  }

  @ContractRoute(routes.adminRecomputeReputation)
  run(): Promise<{ recomputed: number; promoted: number }> {
    return this.recompute.execute();
  }
}
