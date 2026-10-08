import { Module } from '@nestjs/common';
import { ENV } from '../../shared/config/config.module.js';
import type { Env } from '../../shared/config/env.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import { ID_GENERATOR } from '../../shared/infra/id/uuid-v7.generator.js';
import type { Clock } from '../../shared/kernel/clock.js';
import type { IdGenerator } from '../../shared/kernel/domain-event.js';
import { type CaptchaVerifier, JoinWaitlist } from './application/join-waitlist.js';
import {
  DrizzleLeadRepository,
  NoCaptcha,
  TurnstileVerifier,
} from './infrastructure/leads.infra.js';
import { LeadsController } from './interface/leads.controller.js';

export const CAPTCHA_VERIFIER = Symbol('CAPTCHA_VERIFIER');

@Module({
  controllers: [LeadsController],
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
  ],
})
export class LeadsModule {}
