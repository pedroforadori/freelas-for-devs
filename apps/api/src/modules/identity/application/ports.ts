import type { Role } from '@f4d/contracts';
import type { RefreshTokenState } from '../domain/refresh-rotation.js';
import type { User } from '../domain/user.js';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  /** Insere ou atualiza (lock otimista pela `version`) e grava os eventos pendentes no outbox. */
  save(user: User): Promise<void>;
}

export interface RefreshTokenRecord extends RefreshTokenState {
  aal: 1 | 2;
  userAgent: string | null;
  ip: string | null;
}

export interface RefreshTokenRepository {
  insert(record: RefreshTokenRecord & { tokenHash: string }): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Marca como rotacionado apenas se ainda não foi (retorna false se perdeu a corrida). */
  markRotated(id: string, now: Date): Promise<boolean>;
  revokeFamily(familyId: string, now: Date): Promise<void>;
  revokeAllForUser(userId: string, now: Date): Promise<void>;
}

export type OneTimeTokenPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'MFA_CHALLENGE';

export interface OneTimeTokenRepository {
  insert(record: {
    id: string;
    userId: string;
    purpose: OneTimeTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  /** Lê um token válido sem consumi-lo (ex.: desafio de 2FA, que admite novas tentativas). */
  findValid(
    tokenHash: string,
    purpose: OneTimeTokenPurpose,
    now: Date,
  ): Promise<{ id: string; userId: string } | null>;
  /** Consome atomicamente um token válido; retorna o userId ou null (inválido, expirado, usado). */
  consume(tokenHash: string, purpose: OneTimeTokenPurpose, now: Date): Promise<string | null>;
  invalidateAll(userId: string, purpose: OneTimeTokenPurpose, now: Date): Promise<void>;
}

export interface MfaRecord {
  userId: string;
  /** Segredo TOTP cifrado (ver SecretCipher). */
  secretEnc: string;
  enabledAt: Date | null;
  lastUsedStep: number | null;
}

export interface MfaRepository {
  find(userId: string): Promise<MfaRecord | null>;
  /** Grava (ou substitui) uma configuração ainda não confirmada. */
  savePending(userId: string, secretEnc: string): Promise<void>;
  enable(userId: string, now: Date, step: number): Promise<void>;
  /** Registra o passo usado somente se for posterior ao último (condicional no banco). */
  claimStep(userId: string, step: number): Promise<boolean>;
  remove(userId: string): Promise<void>;
  replaceRecoveryCodes(userId: string, codes: { id: string; codeHash: string }[]): Promise<void>;
  /** Consome um código de recuperação não usado; false se inválido ou já usado. */
  consumeRecoveryCode(userId: string, codeHash: string, now: Date): Promise<boolean>;
}

export interface TotpService {
  /** Novo segredo em base32 (160 bits). */
  generateSecret(): string;
  /** URI `otpauth://` para o QR code do app autenticador. */
  provisioningUri(secret: string, accountLabel: string): string;
  /** Passo de tempo correspondente ao código (tolerância de ±1 passo), ou null se inválido. */
  matchStep(secret: string, code: string, now: Date): number | null;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /**
   * Gasta o mesmo tempo de uma verificação real quando o usuário não existe,
   * impedindo descobrir e-mails cadastrados pelo tempo de resposta.
   */
  verifyDummy(password: string): Promise<void>;
}

export interface AccessTokenClaims {
  userId: string;
  roles: Role[];
  sessionId: string;
  /** Nível de autenticação: 1 = senha/OAuth, 2 = com segundo fator. */
  aal: 1 | 2;
}

export interface AccessTokenIssuer {
  issue(claims: AccessTokenClaims): Promise<{ token: string; expiresInSeconds: number }>;
}

/** Tokens opacos de alta entropia: o valor vai para o cliente, só o hash é persistido. */
export interface SecretTokenGenerator {
  generate(): { token: string; hash: string };
  hash(token: string): string;
  /** Código legível para humanos (ex.: recuperação de 2FA): `abcde-fghij`, ~50 bits. */
  readableCode(): string;
}

/** Bloqueio progressivo por conta contra força bruta (complementa o rate limit por IP). */
export interface LoginAttemptLimiter {
  /** Segundos até liberar, ou 0 se não bloqueado. */
  lockedFor(key: string): Promise<number>;
  registerFailure(key: string): Promise<void>;
  reset(key: string): Promise<void>;
}

export interface IdentitySettings {
  refreshTokenTtlMs: number;
  emailVerificationTtlMs: number;
  passwordResetTtlMs: number;
  mfaChallengeTtlMs: number;
  webAppUrl: string;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');
export const ONE_TIME_TOKEN_REPOSITORY = Symbol('ONE_TIME_TOKEN_REPOSITORY');
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const ACCESS_TOKEN_ISSUER = Symbol('ACCESS_TOKEN_ISSUER');
export const SECRET_TOKEN_GENERATOR = Symbol('SECRET_TOKEN_GENERATOR');
export const LOGIN_ATTEMPT_LIMITER = Symbol('LOGIN_ATTEMPT_LIMITER');
export const IDENTITY_SETTINGS = Symbol('IDENTITY_SETTINGS');
