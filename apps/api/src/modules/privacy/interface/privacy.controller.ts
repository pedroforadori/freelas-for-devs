import { Controller, Inject, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { apiRoutes, type DataExport, type DeletionCheck } from '@f4d/contracts';
import type { FastifyReply } from 'fastify';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import {
  AUTH_COOKIES,
  type AuthCookies,
} from '../../../shared/interface/http/auth/auth-cookies.js';
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
import { DeleteMyAccount, ExportMyData } from '../application/use-cases.js';

const routes = apiRoutes.privacy;
const HOUR = 3_600_000;

/** Direitos do titular (LGPD): exportação dos dados e exclusão da conta. */
@Controller()
export class PrivacyController {
  constructor(
    private readonly exporter: ExportMyData,
    private readonly deletion: DeleteMyAccount,
    @Inject(AUTH_COOKIES) private readonly cookies: AuthCookies,
  ) {}

  @ContractRoute(routes.exportMyData)
  @Throttle({ default: { limit: 5, ttl: HOUR } })
  export(
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<DataExport> {
    return this.exporter.execute(principal.userId, meta);
  }

  @ContractRoute(routes.checkAccountDeletion)
  check(@CurrentPrincipal() principal: Principal): Promise<DeletionCheck> {
    return this.deletion.check(principal.userId);
  }

  @ContractRoute(routes.deleteMyAccount)
  @Throttle({ default: { limit: 5, ttl: HOUR } })
  async delete(
    @ValidRequest() { body }: ContractRequest<typeof routes.deleteMyAccount>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.deletion.execute(principal.userId, body.password, meta);
    this.cookies.clearSession(reply);
  }
}
