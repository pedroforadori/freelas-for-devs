import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher, SecretTokenGenerator } from '../application/ports.js';

/**
 * argon2id com os parâmetros mínimos recomendados pela OWASP (m=19 MiB, t=2, p=1).
 * Revisar quando o hardware de produção estiver definido (alvo: ~100 ms por hash).
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export class Argon2PasswordHasher implements PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash(randomBytes(16).toString('hex'));
    await this.verify(await this.dummyHash, password);
  }
}

/** 256 bits aleatórios em base64url; persistimos só o SHA-256 (o token já tem entropia total). */
export class Sha256SecretTokenGenerator implements SecretTokenGenerator {
  generate(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** 10 caracteres de um alfabeto sem ambíguos (sem 0/o, 1/l/i): ~50 bits. */
  readableCode(): string {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    // randomInt faz amostragem uniforme (sem o viés de `byte % 31`).
    const chars = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]);
    return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
  }
}
