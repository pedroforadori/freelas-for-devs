import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AUDIT_LOGGER, type AuditLogger } from '../../shared/application/audit-log.js';
import { SETTINGS_READER, type SettingsReader } from '../../shared/application/settings-reader.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import { QueueName } from '../../shared/infra/queue/queue-names.js';
import type { Clock } from '../../shared/kernel/clock.js';
import { IdentityFacade } from '../identity/application/facade.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LeadsFacade } from '../leads/application/beta.js';
import { LeadsModule } from '../leads/leads.module.js';
import { ProfilesFacade } from '../profiles/application/facade.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { PRIVACY_DEPS, type PrivacyDeps } from './application/ports.js';
import { DeleteMyAccount, ExportMyData, PurgeExpiredData } from './application/use-cases.js';
import { DrizzlePersonalData, DrizzleRetention } from './infrastructure/drizzle-privacy.js';
import { PrivacyController } from './interface/privacy.controller.js';
import { RetentionProcessor } from './interface/privacy.worker.js';

const deps = (
  ctx: DatabaseContext,
  clock: Clock,
  audit: AuditLogger,
  settings: SettingsReader,
  facades: Pick<PrivacyDeps, 'account' | 'profiles' | 'leads'>,
): PrivacyDeps => ({
  data: new DrizzlePersonalData(ctx),
  retention: new DrizzleRetention(ctx),
  ...facades,
  settings,
  audit,
  uow: ctx,
  clock,
});

const BASE = [DatabaseContext, CLOCK, AUDIT_LOGGER, SETTINGS_READER] as const;

/** Direitos do titular e retenção de dados (LGPD; F11). */
@Module({
  imports: [IdentityModule, ProfilesModule, LeadsModule],
  controllers: [PrivacyController],
  providers: [
    {
      provide: PRIVACY_DEPS,
      inject: [...BASE, IdentityFacade, ProfilesFacade, LeadsFacade],
      useFactory: (
        ctx: DatabaseContext,
        clock: Clock,
        audit: AuditLogger,
        settings: SettingsReader,
        identity: IdentityFacade,
        profiles: ProfilesFacade,
        leads: LeadsFacade,
      ) =>
        deps(ctx, clock, audit, settings, {
          account: identity,
          profiles,
          leads,
        }),
    },
    {
      provide: ExportMyData,
      inject: [PRIVACY_DEPS],
      useFactory: (d: PrivacyDeps) => new ExportMyData(d),
    },
    {
      provide: DeleteMyAccount,
      inject: [PRIVACY_DEPS],
      useFactory: (d: PrivacyDeps) => new DeleteMyAccount(d),
    },
    {
      provide: PurgeExpiredData,
      inject: [PRIVACY_DEPS],
      useFactory: (d: PrivacyDeps) => new PurgeExpiredData(d),
    },
  ],
})
export class PrivacyModule {}

const unavailable = () => Promise.reject(new Error('Indisponível no worker.'));

/** No worker, só a retenção (sem as fachadas de conta, que são do processo HTTP). */
@Module({
  imports: [BullModule.registerQueue({ name: QueueName.Privacy })],
  providers: [
    {
      provide: PRIVACY_DEPS,
      inject: [...BASE],
      useFactory: (
        ctx: DatabaseContext,
        clock: Clock,
        audit: AuditLogger,
        settings: SettingsReader,
      ) =>
        deps(ctx, clock, audit, settings, {
          account: { describe: unavailable, verifyPassword: unavailable, erase: unavailable },
          profiles: { erase: unavailable },
          leads: { forget: unavailable },
        }),
    },
    {
      provide: PurgeExpiredData,
      inject: [PRIVACY_DEPS],
      useFactory: (d: PrivacyDeps) => new PurgeExpiredData(d),
    },
    RetentionProcessor,
  ],
})
export class PrivacyWorkerModule {}
