import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { Mailer } from '../../../shared/application/mailer.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type {
  AccessTokenIssuer,
  IdentitySettings,
  LoginAttemptLimiter,
  OneTimeTokenRepository,
  PasswordHasher,
  RefreshTokenRepository,
  SecretTokenGenerator,
  UserRepository,
} from './ports.js';

/** Dependências dos casos de uso de identidade — todas ports, nenhuma implementação concreta. */
export interface IdentityDeps {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  oneTimeTokens: OneTimeTokenRepository;
  hasher: PasswordHasher;
  accessTokens: AccessTokenIssuer;
  secrets: SecretTokenGenerator;
  loginLimiter: LoginAttemptLimiter;
  mailer: Mailer;
  audit: AuditLogger;
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  settings: IdentitySettings;
}

export const IDENTITY_DEPS = Symbol('IDENTITY_DEPS');
