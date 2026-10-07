import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import { roleSchema } from '@f4d/contracts';
import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { AccessTokenClaims, AccessTokenIssuer } from '../application/ports.js';

const ALGORITHM = 'EdDSA';
const ISSUER = 'f4d-api';
const AUDIENCE = 'f4d';

export interface SigningKeys {
  /** Chave atual (assina e verifica). */
  current: { kid: string; privateKey: KeyObject; publicKey: KeyObject };
  /** Chaves anteriores ainda aceitas na verificação durante a rotação. */
  previous: { kid: string; publicKey: KeyObject }[];
}

const pem = (value: string) => value.replace(/\\n/g, '\n').trim();

/** Lê as chaves Ed25519 do ambiente (PEM PKCS#8 / SPKI; aceita `\n` escapado). */
export const loadSigningKeys = (input: {
  privateKeyPem: string;
  keyId: string;
  previousPublicKeys?: { kid: string; pem: string }[];
}): SigningKeys => {
  const privateKey = createPrivateKey(pem(input.privateKeyPem));
  if (privateKey.asymmetricKeyType !== 'ed25519')
    throw new Error('JWT_PRIVATE_KEY deve ser Ed25519.');
  return {
    current: { kid: input.keyId, privateKey, publicKey: createPublicKey(privateKey) },
    previous: (input.previousPublicKeys ?? []).map((key) => ({
      kid: key.kid,
      publicKey: createPublicKey(pem(key.pem)),
    })),
  };
};

/** Chaves efêmeras para dev/teste: sessões não sobrevivem a um restart. */
export const generateEphemeralKeys = (): SigningKeys => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { current: { kid: 'ephemeral', privateKey, publicKey }, previous: [] };
};

const claimsSchema = z.object({
  sub: z.uuid(),
  roles: z.array(roleSchema),
  sid: z.uuid(),
  aal: z.union([z.literal(1), z.literal(2)]),
});

export class InvalidAccessTokenError extends Error {
  constructor(readonly reason: 'expired' | 'invalid') {
    super(`Access token ${reason}`);
  }
}

/** JWT EdDSA de vida curta. Revogação imediata não existe: o TTL curto é o limite de exposição. */
export class JoseAccessTokenService implements AccessTokenIssuer {
  constructor(
    private readonly keys: SigningKeys,
    private readonly ttlSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(claims: AccessTokenClaims): Promise<{ token: string; expiresInSeconds: number }> {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const token = await new SignJWT({ roles: claims.roles, sid: claims.sessionId, aal: claims.aal })
      .setProtectedHeader({ alg: ALGORITHM, kid: this.keys.current.kid, typ: 'at+jwt' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.ttlSeconds)
      .sign(this.keys.current.privateKey);
    return { token, expiresInSeconds: this.ttlSeconds };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(
        token,
        (header) => {
          if (header.kid === this.keys.current.kid) return this.keys.current.publicKey;
          const previous = this.keys.previous.find((key) => key.kid === header.kid);
          if (!previous) throw new InvalidAccessTokenError('invalid');
          return previous.publicKey;
        },
        {
          algorithms: [ALGORITHM],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: 'at+jwt',
          currentDate: this.now(),
        },
      );
      const claims = claimsSchema.parse(payload);
      return {
        userId: claims.sub,
        roles: claims.roles,
        sessionId: claims.sid,
        aal: claims.aal,
      };
    } catch (error) {
      if (error instanceof errors.JWTExpired) throw new InvalidAccessTokenError('expired');
      throw new InvalidAccessTokenError('invalid');
    }
  }
}
