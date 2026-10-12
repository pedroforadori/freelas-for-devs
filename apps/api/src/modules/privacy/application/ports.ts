import type { DataExport } from '@f4d/contracts';
import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { SettingsReader } from '../../../shared/application/settings-reader.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/kernel/clock.js';

/** Leitura dos dados do titular em todos os módulos (read model para a exportação). */
export interface PersonalData {
  export(userId: string, email: string): Promise<Omit<DataExport, 'format' | 'generatedAt'>>;
  /** Contratos e projetos em andamento: enquanto houver, a conta não pode ser excluída. */
  openObligations(userId: string): Promise<{ contracts: number; projects: number }>;
}

/** Prazos de retenção (LGPD: minimização). Cada método devolve quantos registros limpou. */
export interface Retention {
  purgeViolationOriginals(before: Date): Promise<number>;
  purgeOneTimeTokens(before: Date): Promise<number>;
  purgeRefreshTokens(before: Date): Promise<number>;
  purgePublishedOutbox(before: Date): Promise<number>;
  purgeWebhookEvents(before: Date): Promise<number>;
}

export interface AccountGateway {
  describe(userId: string): Promise<{ email: string; hasPassword: boolean; isAdmin: boolean }>;
  verifyPassword(userId: string, password: string): Promise<boolean>;
  erase(userId: string): Promise<void>;
}

export interface PrivacyDeps {
  data: PersonalData;
  retention: Retention;
  account: AccountGateway;
  profiles: { erase(userId: string): Promise<void> };
  leads: { forget(email: string): Promise<void> };
  settings: SettingsReader;
  audit: AuditLogger;
  uow: UnitOfWork;
  clock: Clock;
}

export const PRIVACY_DEPS = Symbol('PRIVACY_DEPS');
