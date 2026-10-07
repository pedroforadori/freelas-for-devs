import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generateEphemeralKeys,
  InvalidAccessTokenError,
  JoseAccessTokenService,
  loadSigningKeys,
} from './access-tokens.js';

const claims = {
  userId: '0190f5a0-0000-7000-8000-000000000001',
  roles: ['CLIENT' as const],
  sessionId: '0190f5a0-0000-7000-8000-000000000002',
  aal: 1 as const,
};

const escapedPem = (pem: string) => pem.trim().replace(/\n/g, '\\n');

describe('JoseAccessTokenService', () => {
  it('issues and verifies a token round-trip', async () => {
    const service = new JoseAccessTokenService(generateEphemeralKeys(), 900);
    const { token, expiresInSeconds } = await service.issue(claims);
    expect(expiresInSeconds).toBe(900);
    await expect(service.verify(token)).resolves.toEqual(claims);
  });

  it('rejects expired tokens', async () => {
    let now = new Date('2026-03-01T12:00:00Z');
    const service = new JoseAccessTokenService(generateEphemeralKeys(), 60, () => now);
    const { token } = await service.issue(claims);
    now = new Date('2026-03-01T12:02:00Z');
    await expect(service.verify(token)).rejects.toMatchObject({ reason: 'expired' });
  });

  it('rejects tokens signed by another key or tampered with', async () => {
    const service = new JoseAccessTokenService(generateEphemeralKeys(), 900);
    const other = new JoseAccessTokenService(generateEphemeralKeys(), 900);
    const { token } = await other.issue(claims);
    await expect(service.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);

    const [header, payload] = (await service.issue(claims)).token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
        roles: ['ADMIN'],
      }),
    ).toString('base64url');
    await expect(service.verify(`${header}.${forgedPayload}.`)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('accepts tokens from the previous key during rotation', async () => {
    const old = generateKeyPairSync('ed25519');
    const oldService = new JoseAccessTokenService(
      loadSigningKeys({
        keyId: 'k0',
        privateKeyPem: escapedPem(
          old.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        ),
      }),
      900,
    );
    const { token } = await oldService.issue(claims);

    const fresh = generateKeyPairSync('ed25519');
    const rotated = new JoseAccessTokenService(
      loadSigningKeys({
        keyId: 'k1',
        privateKeyPem: fresh.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        previousPublicKeys: [
          { kid: 'k0', pem: old.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
        ],
      }),
      900,
    );
    await expect(rotated.verify(token)).resolves.toEqual(claims);
  });

  it('refuses non-Ed25519 keys', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() =>
      loadSigningKeys({
        keyId: 'x',
        privateKeyPem: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      }),
    ).toThrow('Ed25519');
  });
});
