import { Global, Module } from '@nestjs/common';
import { AUDIT_LOGGER } from '../application/audit-log.js';
import { systemClock } from '../kernel/clock.js';
import { DrizzleAuditLogger } from './audit/drizzle-audit.logger.js';
import { DatabaseContext } from './database/database-context.js';
import { ID_GENERATOR, UuidV7Generator } from './id/uuid-v7.generator.js';

export const CLOCK = Symbol('CLOCK');

/** Serviços transversais disponíveis a todos os módulos: relógio, ids e auditoria. */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useValue: systemClock },
    { provide: ID_GENERATOR, useClass: UuidV7Generator },
    {
      provide: AUDIT_LOGGER,
      inject: [DatabaseContext, ID_GENERATOR],
      useFactory: (ctx: DatabaseContext, ids: UuidV7Generator) => new DrizzleAuditLogger(ctx, ids),
    },
  ],
  exports: [CLOCK, ID_GENERATOR, AUDIT_LOGGER],
})
export class CoreModule {}
