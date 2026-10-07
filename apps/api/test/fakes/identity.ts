import { createHash, randomBytes } from 'node:crypto';
import type { AuditEntry, AuditLogger } from '../../src/shared/application/audit-log.js';
import type { EmailMessage, Mailer } from '../../src/shared/application/mailer.js';
import type { UnitOfWork } from '../../src/shared/application/unit-of-work.js';
import { FakeClock } from '../../src/shared/kernel/clock.js';
import { ConcurrencyError } from '../../src/shared/kernel/domain-error.js';
import type { IdGenerator, PendingDomainEvent } from '../../src/shared/kernel/domain-event.js';
import type { IdentityDeps } from '../../src/modules/identity/application/deps.js';
import type {
  AccessTokenClaims,
  AccessTokenIssuer,
  LoginAttemptLimiter,
  OneTimeTokenPurpose,
  OneTimeTokenRepository,
  PasswordHasher,
  RefreshTokenRecord,
  RefreshTokenRepository,
  SecretTokenGenerator,
  UserRepository,
} from '../../src/modules/identity/application/ports.js';
import { User, type UserSnapshot } from '../../src/modules/identity/domain/user.js';
import { DAY_MS, HOUR_MS } from '../../src/shared/kernel/clock.js';

export class SequentialIds implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `00000000-0000-7000-8000-${String(this.n).padStart(12, '0')}`;
  }
}

export class InMemoryUsers implements UserRepository {
  readonly rows = new Map<string, UserSnapshot>();
  readonly events: PendingDomainEvent[] = [];

  findById(id: string) {
    const row = this.rows.get(id);
    return Promise.resolve(row ? User.rehydrate(row) : null);
  }
  findByEmail(email: string) {
    const row = [...this.rows.values()].find((r) => r.email === email);
    return Promise.resolve(row ? User.rehydrate(row) : null);
  }
  save(user: User) {
    const current = this.rows.get(user.id);
    if ((current?.version ?? 0) !== user.version) throw new ConcurrencyError('User', user.id);
    this.events.push(...user.pullEvents());
    user.markPersisted();
    this.rows.set(user.id, user.toSnapshot());
    return Promise.resolve();
  }
}

export class InMemoryRefreshTokens implements RefreshTokenRepository {
  readonly rows: (RefreshTokenRecord & { tokenHash: string })[] = [];
  insert(record: RefreshTokenRecord & { tokenHash: string }) {
    this.rows.push({ ...record });
    return Promise.resolve();
  }
  findByHash(tokenHash: string) {
    return Promise.resolve(this.rows.find((r) => r.tokenHash === tokenHash) ?? null);
  }
  markRotated(id: string, now: Date) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.rotatedAt) return Promise.resolve(false);
    row.rotatedAt = now;
    return Promise.resolve(true);
  }
  revokeFamily(familyId: string, now: Date) {
    for (const r of this.rows) if (r.familyId === familyId) r.revokedAt ??= now;
    return Promise.resolve();
  }
  revokeAllForUser(userId: string, now: Date) {
    for (const r of this.rows) if (r.userId === userId) r.revokedAt ??= now;
    return Promise.resolve();
  }
  activeFamilies(userId: string): Set<string> {
    return new Set(
      this.rows.filter((r) => r.userId === userId && !r.revokedAt).map((r) => r.familyId),
    );
  }
}

interface OneTimeRow {
  id: string;
  userId: string;
  purpose: OneTimeTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export class InMemoryOneTimeTokens implements OneTimeTokenRepository {
  readonly rows: OneTimeRow[] = [];
  insert(record: Omit<OneTimeRow, 'consumedAt'>) {
    this.rows.push({ ...record, consumedAt: null });
    return Promise.resolve();
  }
  consume(tokenHash: string, purpose: OneTimeTokenPurpose, now: Date) {
    const row = this.rows.find(
      (r) =>
        r.tokenHash === tokenHash && r.purpose === purpose && !r.consumedAt && r.expiresAt > now,
    );
    if (!row) return Promise.resolve(null);
    row.consumedAt = now;
    return Promise.resolve(row.userId);
  }
  invalidateAll(userId: string, purpose: OneTimeTokenPurpose, now: Date) {
    for (const r of this.rows)
      if (r.userId === userId && r.purpose === purpose) r.consumedAt ??= now;
    return Promise.resolve();
  }
}

/** Hash reversível de mentira: rápido e suficiente para testar o fluxo. */
export class FakeHasher implements PasswordHasher {
  dummyCalls = 0;
  hash(password: string) {
    return Promise.resolve(`hashed:${password}`);
  }
  verify(hash: string, password: string) {
    return Promise.resolve(hash === `hashed:${password}`);
  }
  verifyDummy() {
    this.dummyCalls += 1;
    return Promise.resolve();
  }
}

export class FakeAccessTokens implements AccessTokenIssuer {
  readonly issued: AccessTokenClaims[] = [];
  issue(claims: AccessTokenClaims) {
    this.issued.push(claims);
    return Promise.resolve({
      token: `access:${claims.userId}:${this.issued.length}`,
      expiresInSeconds: 900,
    });
  }
}

export class RealSecrets implements SecretTokenGenerator {
  generate() {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }
  hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}

export class InMemoryLoginLimiter implements LoginAttemptLimiter {
  readonly failures = new Map<string, number>();
  constructor(private readonly maxFailures = 5) {}
  lockedFor(key: string) {
    return Promise.resolve((this.failures.get(key) ?? 0) >= this.maxFailures ? 900 : 0);
  }
  registerFailure(key: string) {
    this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
    return Promise.resolve();
  }
  reset(key: string) {
    this.failures.delete(key);
    return Promise.resolve();
  }
}

export class RecordingMailer implements Mailer {
  readonly sent: EmailMessage[] = [];
  send(message: EmailMessage) {
    this.sent.push(message);
    return Promise.resolve();
  }
  /** Extrai o token do último link enviado para `to` com a tag informada. */
  lastToken(to: string, tag: string): string {
    const message = [...this.sent].reverse().find((m) => m.to === to && m.tag === tag);
    const token = message?.text.match(/token=([\w-]+)/)?.[1];
    if (!token) throw new Error(`Nenhum token enviado para ${to} (${tag}).`);
    return token;
  }
}

export class RecordingAudit implements AuditLogger {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry) {
    this.entries.push(entry);
    return Promise.resolve();
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}

/** UoW de teste: sem rollback real — testes de atomicidade usam PGlite. */
export const passthroughUow: UnitOfWork = { run: (work) => work() };

export const createIdentityTestDeps = () => {
  const deps = {
    users: new InMemoryUsers(),
    refreshTokens: new InMemoryRefreshTokens(),
    oneTimeTokens: new InMemoryOneTimeTokens(),
    hasher: new FakeHasher(),
    accessTokens: new FakeAccessTokens(),
    secrets: new RealSecrets(),
    loginLimiter: new InMemoryLoginLimiter(),
    mailer: new RecordingMailer(),
    audit: new RecordingAudit(),
    uow: passthroughUow,
    clock: new FakeClock('2026-03-01T12:00:00Z'),
    ids: new SequentialIds(),
    settings: {
      refreshTokenTtlMs: 30 * DAY_MS,
      emailVerificationTtlMs: 24 * HOUR_MS,
      passwordResetTtlMs: HOUR_MS,
      webAppUrl: 'https://app.test',
    },
  } satisfies IdentityDeps;
  return deps;
};
