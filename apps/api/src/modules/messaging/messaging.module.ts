import { Module } from '@nestjs/common';
import { AUDIT_LOGGER, type AuditLogger } from '../../shared/application/audit-log.js';
import { MAILER, type Mailer } from '../../shared/application/mailer.js';
import { SECRET_CIPHER, type SecretCipher } from '../../shared/application/secret-cipher.js';
import { SETTINGS_READER, type SettingsReader } from '../../shared/application/settings-reader.js';
import { ENV } from '../../shared/config/config.module.js';
import type { Env } from '../../shared/config/env.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import { ID_GENERATOR } from '../../shared/infra/id/uuid-v7.generator.js';
import type { Clock } from '../../shared/kernel/clock.js';
import { RegexContactDetector } from '../../shared/kernel/contact-detector.js';
import type { IdGenerator } from '../../shared/kernel/domain-event.js';
import { ContractsFacade } from '../contracts/application/facade.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { IdentityFacade } from '../identity/application/facade.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ProjectsFacade } from '../projects/application/facade.js';
import { ProjectsModule } from '../projects/projects.module.js';
import {
  MESSAGING_DEPS,
  type MessagingDeps,
  REALTIME_PUBLISHER,
  type RealtimePublisher,
} from './application/ports.js';
import {
  Moderate,
  OpenConversation,
  ReadConversations,
  ScreenText,
  SendMessage,
} from './application/use-cases.js';
import {
  DrizzleConversations,
  DrizzleMessages,
  DrizzleMessagingPeople,
  DrizzleModerationLog,
  DrizzleReadMarkers,
  DrizzleViolations,
} from './infrastructure/drizzle-messaging.js';
import { ChatBroadcaster, ChatGateway } from './interface/chat.gateway.js';
import { MessagingController, ModerationController } from './interface/messaging.controller.js';

const SIMPLE_USE_CASES = [OpenConversation, ReadConversations, ScreenText, Moderate] as const;

/** Chat (escopo e contrato), triagem de contato e moderação (F3). */
@Module({
  imports: [ProjectsModule, ContractsModule, IdentityModule],
  controllers: [MessagingController, ModerationController],
  providers: [
    ChatGateway,
    ChatBroadcaster,
    { provide: REALTIME_PUBLISHER, useExisting: ChatBroadcaster },
    {
      provide: MESSAGING_DEPS,
      inject: [
        ENV,
        DatabaseContext,
        ID_GENERATOR,
        CLOCK,
        AUDIT_LOGGER,
        MAILER,
        SETTINGS_READER,
        SECRET_CIPHER,
        REALTIME_PUBLISHER,
        ProjectsFacade,
        ContractsFacade,
        IdentityFacade,
      ],
      useFactory: (
        env: Env,
        ctx: DatabaseContext,
        ids: IdGenerator,
        clock: Clock,
        audit: AuditLogger,
        mailer: Mailer,
        settings: SettingsReader,
        cipher: SecretCipher,
        realtime: RealtimePublisher,
        projects: ProjectsFacade,
        contracts: ContractsFacade,
        identity: IdentityFacade,
      ): MessagingDeps => ({
        conversations: new DrizzleConversations(ctx),
        messages: new DrizzleMessages(ctx),
        reads: new DrizzleReadMarkers(ctx),
        violations: new DrizzleViolations(ctx),
        moderation: new DrizzleModerationLog(ctx),
        projects: { find: (projectId) => projects.find(projectId) },
        contracts: { find: (contractId) => contracts.find(contractId) },
        accounts: {
          suspend: (userId) => identity.suspend(userId),
          reinstate: (userId) => identity.reinstate(userId),
        },
        people: new DrizzleMessagingPeople(ctx),
        realtime,
        detector: new RegexContactDetector(),
        cipher,
        settings,
        mailer,
        audit,
        uow: ctx,
        clock,
        ids,
        webAppUrl: env.WEB_APP_URL,
      }),
    },
    ...SIMPLE_USE_CASES.map((UseCase) => ({
      provide: UseCase,
      inject: [MESSAGING_DEPS],
      useFactory: (deps: MessagingDeps) => new UseCase(deps),
    })),
    {
      provide: SendMessage,
      inject: [MESSAGING_DEPS, ScreenText],
      useFactory: (deps: MessagingDeps, screen: ScreenText) => new SendMessage(deps, screen),
    },
  ],
  exports: [ScreenText],
})
export class MessagingModule {}
