import { Module } from '@nestjs/common';
import { AUDIT_LOGGER, type AuditLogger } from '../../shared/application/audit-log.js';
import { MAILER, type Mailer } from '../../shared/application/mailer.js';
import { SETTINGS_READER, type SettingsReader } from '../../shared/application/settings-reader.js';
import { ENV } from '../../shared/config/config.module.js';
import type { Env } from '../../shared/config/env.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import { ID_GENERATOR } from '../../shared/infra/id/uuid-v7.generator.js';
import type { Clock } from '../../shared/kernel/clock.js';
import type { IdGenerator } from '../../shared/kernel/domain-event.js';
import { type BetaDeps, LeadsFacade, ManageBeta } from './application/beta.js';
import { type CaptchaVerifier, JoinWaitlist } from './application/join-waitlist.js';
import {
  DrizzleBetaStore,
  DrizzleLeadRepository,
  NoCaptcha,
  TurnstileVerifier,
} from './infrastructure/leads.infra.js';
import { AdminBetaController, LeadsController } from './interface/leads.controller.js';

export const CAPTCHA_VERIFIER = Symbol('CAPTCHA_VERIFIER');
const BETA_DEPS = Symbol('BETA_DEPS');

@Module({
  controllers: [LeadsController, AdminBetaController],
  providers: [
    {
      provide: CAPTCHA_VERIFIER,
      inject: [ENV],
      useFactory: (env: Env): CaptchaVerifier =>
        env.TURNSTILE_SECRET_KEY
          ? new TurnstileVerifier(env.TURNSTILE_SECRET_KEY)
          : new NoCaptcha(),
    },
    {
      provide: JoinWaitlist,
      inject: [DatabaseContext, CAPTCHA_VERIFIER, CLOCK, ID_GENERATOR],
      useFactory: (
        ctx: DatabaseContext,
        captcha: CaptchaVerifier,
        clock: Clock,
        ids: IdGenerator,
      ) => new JoinWaitlist({ leads: new DrizzleLeadRepository(ctx), captcha, clock, ids }),
    },
    {
      provide: BETA_DEPS,
      inject: [ENV, DatabaseContext, SETTINGS_READER, MAILER, AUDIT_LOGGER, CLOCK],
      useFactory: (
        env: Env,
        ctx: DatabaseContext,
        settings: SettingsReader,
        mailer: Mailer,
        audit: AuditLogger,
        clock: Clock,
      ): BetaDeps => ({
        store: new DrizzleBetaStore(ctx),
        settings,
        mailer,
        audit,
        clock,
        webAppUrl: env.WEB_APP_URL,
      }),
    },
    {
      provide: LeadsFacade,
      inject: [BETA_DEPS],
      useFactory: (deps: BetaDeps) => new LeadsFacade(deps),
    },
    {
      provide: ManageBeta,
      inject: [BETA_DEPS],
      useFactory: (deps: BetaDeps) => new ManageBeta(deps),
    },
  ],
  exports: [LeadsFacade],
})
export class LeadsModule {}
