import { Global, Module } from '@nestjs/common';
import { AUDIT_LOGGER, type AuditLogger } from '../../shared/application/audit-log.js';
import { SETTINGS_READER } from '../../shared/application/settings-reader.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import type { Clock } from '../../shared/kernel/clock.js';
import { SETTINGS_DEPS, type SettingsDeps } from './application/ports.js';
import { ListSettings, StoredSettingsReader, UpdateSetting } from './application/use-cases.js';
import { DrizzleSettingsStore } from './infrastructure/drizzle-settings.store.js';
import { SettingsController } from './interface/settings.controller.js';

const providers = [
  {
    provide: SETTINGS_DEPS,
    inject: [DatabaseContext, AUDIT_LOGGER, CLOCK],
    useFactory: (ctx: DatabaseContext, audit: AuditLogger, clock: Clock): SettingsDeps => ({
      store: new DrizzleSettingsStore(ctx),
      audit,
      uow: ctx,
      clock,
    }),
  },
  ...[ListSettings, UpdateSetting].map((UseCase) => ({
    provide: UseCase,
    inject: [SETTINGS_DEPS],
    useFactory: (deps: SettingsDeps) => new UseCase(deps),
  })),
  {
    provide: SETTINGS_READER,
    inject: [SETTINGS_DEPS],
    useFactory: (deps: SettingsDeps) => new StoredSettingsReader(deps),
  },
];

/**
 * Parâmetros de negócio. Global: qualquer módulo injeta SETTINGS_READER (porta compartilhada)
 * sem depender da implementação deste módulo.
 */
@Global()
@Module({ controllers: [SettingsController], providers, exports: [SETTINGS_READER] })
export class SettingsModule {}

/** Worker: só leitura (prazos e limites usados pelos jobs). */
@Global()
@Module({ providers, exports: [SETTINGS_READER] })
export class SettingsReaderModule {}
