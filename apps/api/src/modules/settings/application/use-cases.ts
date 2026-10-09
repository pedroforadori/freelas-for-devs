import { SETTINGS, type SettingKey, type SettingValue } from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import type { SettingsReader } from '../../../shared/application/settings-reader.js';
import { DomainError } from '../../../shared/kernel/domain-error.js';
import type { SettingsDeps, StoredSetting } from './ports.js';

export class InvalidSettingValueError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(key: string, reason: string) {
    super(`Valor inválido para "${key}": ${reason}`, { key });
  }
}

export class StaleSettingError extends DomainError {
  readonly code = 'CONFLICT';
  constructor(key: string) {
    super(`"${key}" foi alterado por outra pessoa. Recarregue e tente de novo.`, { key });
  }
}

export interface SettingView {
  key: SettingKey;
  value: unknown;
  defaultValue: unknown;
  version: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

const view = (key: SettingKey, stored: StoredSetting | undefined | null): SettingView => ({
  key,
  value: stored ? stored.value : SETTINGS[key].default,
  defaultValue: SETTINGS[key].default,
  version: stored?.version ?? 0,
  updatedAt: stored?.updatedAt ?? null,
  updatedBy: stored?.updatedBy ?? null,
});

export class ListSettings {
  constructor(private readonly deps: SettingsDeps) {}

  async execute(): Promise<SettingView[]> {
    const stored = new Map((await this.deps.store.list()).map((row) => [row.key, row]));
    return (Object.keys(SETTINGS) as SettingKey[]).map((key) => view(key, stored.get(key)));
  }
}

/** Alteração validada pelo schema da chave, com lock otimista e auditoria (antes → depois). */
export class UpdateSetting {
  constructor(private readonly deps: SettingsDeps) {}

  async execute(
    adminId: string,
    key: SettingKey,
    input: { value: unknown; expectedVersion: number },
    meta: RequestMeta,
  ): Promise<SettingView> {
    const parsed = SETTINGS[key].schema.safeParse(input.value);
    if (!parsed.success)
      throw new InvalidSettingValueError(
        key,
        parsed.error.issues[0]?.message ?? 'formato inválido',
      );

    await this.deps.uow.run(async () => {
      const before = await this.deps.store.find(key);
      const saved = await this.deps.store.save({
        key,
        value: parsed.data,
        expectedVersion: input.expectedVersion,
        updatedBy: adminId,
        now: this.deps.clock.now(),
      });
      if (!saved) throw new StaleSettingError(key);
      await this.deps.audit.record({
        actorId: adminId,
        action: 'admin.setting_changed',
        targetType: 'setting',
        targetId: key,
        metadata: { before: before?.value ?? SETTINGS[key].default, after: parsed.data },
        request: meta,
      });
    });
    return view(key, await this.deps.store.find(key));
  }
}

/** Implementação da porta compartilhada: valor salvo (revalidado) ou o padrão do registro. */
export class StoredSettingsReader implements SettingsReader {
  constructor(private readonly deps: SettingsDeps) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const stored = await this.deps.store.find(key);
    const definition = SETTINGS[key];
    // Um valor gravado que não passe mais no schema (ex.: limite apertado depois) cai no padrão.
    const parsed = stored ? definition.schema.safeParse(stored.value) : null;
    return (parsed?.success ? parsed.data : definition.default) as SettingValue<K>;
  }
}
