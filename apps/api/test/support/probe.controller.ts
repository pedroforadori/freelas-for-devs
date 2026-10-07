import { Controller, Get } from '@nestjs/common';
import { defineRoute, Permission } from '@f4d/contracts';
import { z } from 'zod';
import { ContractRoute } from '../../src/shared/interface/http/contract-route.js';

/** Rota administrativa de teste: exige permissão de Admin (e, portanto, sessão com 2FA). */
export const adminProbeRoute = defineRoute({
  method: 'get',
  path: '/v1/test/admin-probe',
  operationId: 'adminProbe',
  summary: 'Teste',
  tags: ['test'],
  auth: { permission: Permission.AdminUsersRead },
  request: {},
  responses: { 200: z.object({ ok: z.literal(true) }) },
});

@Controller()
export class ProbeController {
  @ContractRoute(adminProbeRoute)
  admin() {
    return { ok: true as const };
  }

  /** Sem @ContractRoute nem @Public: o guard deve negar. */
  @Get('/v1/test/forgotten')
  forgotten() {
    return { leaked: true };
  }
}
