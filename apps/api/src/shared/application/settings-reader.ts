import type { SettingKey, SettingValue } from '@f4d/contracts';

/**
 * Leitura tipada dos parâmetros de negócio (módulo de configurações é o dono). Devolve o valor
 * alterado pelo Admin ou o padrão do registro. Quem cria rodadas e contratos copia os valores
 * no momento da criação (snapshot), nunca relê depois.
 */
export interface SettingsReader {
  get<K extends SettingKey>(key: K): Promise<SettingValue<K>>;
}

export const SETTINGS_READER = Symbol('SETTINGS_READER');
