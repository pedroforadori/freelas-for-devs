import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeAccessTokens,
  FakeHasher,
  InMemoryLoginLimiter,
  RecordingAudit,
  RecordingMailer,
} from '../../../../test/fakes/identity.js';
import { createTestDatabase, type TestDatabase } from '../../../../test/support/pglite.js';
import { outboxEvents } from '../../../db/schema/outbox.js';
import { DatabaseContext } from '../../../shared/infra/database/database-context.js';
import { UuidV7Generator } from '../../../shared/infra/id/uuid-v7.generator.js';
import { DAY_MS, FakeClock, HOUR_MS } from '../../../shared/kernel/clock.js';
import { ConcurrencyError } from '../../../shared/kernel/domain-error.js';
import type { IdentityDeps } from '../application/deps.js';
import { RegisterUser, RequestPasswordReset, ResetPassword } from '../application/use-cases.js';
import { EmailAlreadyRegisteredError, WeakPasswordError } from '../domain/errors.js';
import { User } from '../domain/user.js';
import { Sha256SecretTokenGenerator } from './crypto.js';
import {
  DrizzleOneTimeTokenRepository,
  DrizzleRefreshTokenRepository,
  DrizzleUserRepository,
} from './drizzle-identity.repositories.js';

/** Repositórios contra Postgres real (PGlite): SQL, constraints, transações e outbox. */
let database: TestDatabase;
let ctx: DatabaseContext;
let deps: IdentityDeps;
let mailer: RecordingMailer;
const meta = { ip: null, userAgent: null, requestId: null };

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  ctx = new DatabaseContext(database.db);
  const ids = new UuidV7Generator();
  mailer = new RecordingMailer();
  deps = {
    users: new DrizzleUserRepository(ctx, ids),
    refreshTokens: new DrizzleRefreshTokenRepository(ctx),
    oneTimeTokens: new DrizzleOneTimeTokenRepository(ctx),
    hasher: new FakeHasher(),
    accessTokens: new FakeAccessTokens(),
    secrets: new Sha256SecretTokenGenerator(),
    loginLimiter: new InMemoryLoginLimiter(),
    mailer,
    audit: new RecordingAudit(),
    uow: ctx,
    clock: new FakeClock(new Date()),
    ids,
    settings: {
      refreshTokenTtlMs: 30 * DAY_MS,
      emailVerificationTtlMs: 24 * HOUR_MS,
      passwordResetTtlMs: HOUR_MS,
      webAppUrl: 'https://app.test',
    },
  };
});

const register = (email = 'ana@exemplo.com') =>
  new RegisterUser(deps).execute(
    { email, password: 'uma senha bem longa', displayName: 'Ana Lima', role: 'FREELANCER' },
    meta,
  );

describe('DrizzleUserRepository', () => {
  it('persists users with roles and writes domain events to the outbox atomically', async () => {
    const { user } = await register();

    const loaded = await deps.users.findByEmail('ANA@exemplo.com');
    expect(loaded?.toSnapshot()).toMatchObject({ id: user.id, roles: ['FREELANCER'], version: 1 });
    const events = await database.db.select().from(outboxEvents);
    expect(events.map((e) => e.type)).toEqual(['identity.UserRegistered']);
  });

  it('maps the unique e-mail constraint to a domain error (concurrent sign-ups)', async () => {
    await register();
    const twin = User.register({
      id: new UuidV7Generator().next(),
      email: 'ana@exemplo.com',
      passwordHash: 'x',
      displayName: 'Outra Ana',
      role: 'CLIENT',
      now: new Date(),
    });
    await expect(deps.users.save(twin)).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('rejects stale writes with optimistic locking', async () => {
    const { user } = await register();
    const copyA = (await deps.users.findById(user.id))!;
    const copyB = (await deps.users.findById(user.id))!;

    copyA.verifyEmail(new Date());
    await deps.users.save(copyA);
    copyB.changePassword('outro-hash', new Date());
    await expect(deps.users.save(copyB)).rejects.toBeInstanceOf(ConcurrencyError);
  });
});

describe('transactions', () => {
  it('rolls back everything — including the burned token — when the new password is refused', async () => {
    await register();
    await new RequestPasswordReset(deps).execute('ana@exemplo.com', meta);
    const token = mailer.lastToken('ana@exemplo.com', 'auth.password-reset');

    await expect(
      new ResetPassword(deps).execute({ token, password: 'senha12345' }, meta),
    ).rejects.toBeInstanceOf(WeakPasswordError);

    // O mesmo link continua válido para uma senha aceitável.
    await expect(
      new ResetPassword(deps).execute({ token, password: 'outra senha muito boa' }, meta),
    ).resolves.toBeUndefined();
  });

  it('consumes a one-time token only once', async () => {
    const { user } = await register();
    const { token, hash } = deps.secrets.generate();
    await deps.oneTimeTokens.insert({
      id: deps.ids.next(),
      userId: user.id,
      purpose: 'EMAIL_VERIFICATION',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + HOUR_MS),
    });
    const now = new Date();
    const results = await Promise.all([
      deps.oneTimeTokens.consume(deps.secrets.hash(token), 'EMAIL_VERIFICATION', now),
      deps.oneTimeTokens.consume(deps.secrets.hash(token), 'EMAIL_VERIFICATION', now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('rotates a refresh token only once', async () => {
    const { session } = await register();
    const record = (await deps.refreshTokens.findByHash(deps.secrets.hash(session.refreshToken)))!;
    expect(await deps.refreshTokens.markRotated(record.id, new Date())).toBe(true);
    expect(await deps.refreshTokens.markRotated(record.id, new Date())).toBe(false);
  });
});
