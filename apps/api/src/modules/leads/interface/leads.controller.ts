import { Controller } from '@nestjs/common';
import type { BetaOverview } from '@f4d/contracts';
import { Throttle } from '@nestjs/throttler';
import { apiRoutes } from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import {
  CurrentPrincipal,
  type Principal,
  RequestContext,
  SkipCsrf,
} from '../../../shared/interface/http/auth/principal.js';
import { ManageBeta } from '../application/beta.js';
import {
  type ContractRequest,
  ContractRoute,
  ValidRequest,
} from '../../../shared/interface/http/contract-route.js';
import { JoinWaitlist } from '../application/join-waitlist.js';

@Controller()
export class LeadsController {
  constructor(private readonly joinWaitlist: JoinWaitlist) {}

  /**
   * Formulário público da landing (outro site, sem sessão nem cookie CSRF). Sem cookies não há
   * o que forjar; a proteção é anti-bot: rate limit por IP, honeypot e Turnstile.
   */
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @ContractRoute(apiRoutes.leads.create)
  async create(
    @ValidRequest() { body }: ContractRequest<typeof apiRoutes.leads.create>,
    @RequestContext() meta: RequestMeta,
  ): Promise<void> {
    await this.joinWaitlist.execute(body, meta.ip);
  }
}

@Controller()
export class AdminBetaController {
  constructor(private readonly beta: ManageBeta) {}

  @ContractRoute(apiRoutes.leads.adminBetaOverview)
  overview(): Promise<BetaOverview> {
    return this.beta.overview();
  }

  @ContractRoute(apiRoutes.leads.adminInviteToBeta)
  async invite(
    @ValidRequest() { body }: ContractRequest<typeof apiRoutes.leads.adminInviteToBeta>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<{ invited: number }> {
    return { invited: await this.beta.invite(principal.userId, body.emails, meta) };
  }
}
