import type { SettingKey } from '@f4d/contracts';
import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/kernel/clock.js';

export interface StoredSetting {
  key: SettingKey;
  value: unknown;
  version: number;
  updatedAt: Date;
  updatedBy: string;
}

export interface SettingsStore {
  list(): Promise<StoredSetting[]>;
  find(key: SettingKey): Promise<StoredSetting | null>;
  /** Grava com lock otimista; false se outra alteração aconteceu desde `expectedVersion`. */
  save(input: {
    key: SettingKey;
    value: unknown;
    expectedVersion: number;
    updatedBy: string;
    now: Date;
  }): Promise<boolean>;
}

export interface SettingsDeps {
  store: SettingsStore;
  audit: AuditLogger;
  uow: UnitOfWork;
  clock: Clock;
}

export const SETTINGS_DEPS = Symbol('SETTINGS_DEPS');
