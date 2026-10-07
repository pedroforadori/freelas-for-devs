import { Controller, Inject, Res } from '@nestjs/common';
import { apiRoutes, type LivenessResponse, type ReadinessResponse } from '@f4d/contracts';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { ENV } from '../../../shared/config/config.module.js';
import type { Env } from '../../../shared/config/env.js';
import { ContractRoute } from '../../../shared/interface/http/contract-route.js';
import { CheckReadiness } from '../application/check-readiness.js';

@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly checkReadiness: CheckReadiness,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @ContractRoute(apiRoutes.health.liveness)
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      version: this.env.APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  @ContractRoute(apiRoutes.health.readiness)
  async readiness(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResponse> {
    const report = await this.checkReadiness.execute();
    if (report.status !== 'ready') void reply.status(503);
    return report;
  }
}
