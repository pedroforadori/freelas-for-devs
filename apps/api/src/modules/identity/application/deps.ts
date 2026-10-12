import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { Mailer } from '../../../shared/application/mailer.js';
import type { SecretCipher } from '../../../shared/application/secret-cipher.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type {
  AccessTokenIssuer,
  AuthIdentityRepository,
  IdentitySettings,
  LoginAttemptLimiter,
  MfaRepository,
  OneTimeTokenRepository,
  PasswordHasher,
  RefreshTokenRepository,
  SecretTokenGenerator,
  TotpService,
  UserRepository,
} from './ports.js';

/** Dependências dos casos de uso de identidade — todas ports, nenhuma implementação concreta. */
export interface IdentityDeps {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  oneTimeTokens: OneTimeTokenRepository;
  mfa: MfaRepository;
  authIdentities: AuthIdentityRepository;
  totp: TotpService;
  cipher: SecretCipher;
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
  /** Beta fechado: só e-mails convidados criam conta (módulo de leads decide). */
  signupGate: { allows(email: string): Promise<boolean> };
}

export const IDENTITY_DEPS = Symbol('IDENTITY_DEPS');
