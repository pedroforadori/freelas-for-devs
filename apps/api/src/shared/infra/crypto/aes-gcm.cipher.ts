import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SecretCipher } from '../../application/secret-cipher.js';

export interface CipherKey {
  id: string;
  /** 32 bytes. */
  key: Buffer;
}

/**
 * AES-256-GCM (autenticado). Formato: `<kid>.<iv>.<tag>.<ciphertext>` em base64url.
 * O `kid` permite rotacionar a chave: novos valores usam a atual; antigos continuam legíveis
 * enquanto a chave anterior estiver no keyring (e podem ser recifrados em background).
 */
export class AesGcmCipher implements SecretCipher {
  private readonly keys: Map<string, Buffer>;

  constructor(
    private readonly current: CipherKey,
    previous: readonly CipherKey[] = [],
  ) {
    for (const k of [current, ...previous]) {
      if (k.key.length !== 32) throw new Error(`Chave de cifra ${k.id} deve ter 32 bytes.`);
      if (!/^[\w-]+$/.test(k.id)) throw new Error(`Id de chave inválido: ${k.id}`);
    }
    this.keys = new Map([current, ...previous].map((k) => [k.id, k.key]));
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.current.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [this.current.id, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  decrypt(value: string): string {
    const [kid, iv, tag, ciphertext] = value.split('.');
    const key = kid ? this.keys.get(kid) : undefined;
    if (!key || !iv || !tag || ciphertext === undefined)
      throw new Error('Valor cifrado inválido ou chave desconhecida.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/** Chave fixa só para dev/teste — o schema de env exige a real em produção. */
export const developmentCipherKey = (): CipherKey => ({
  id: 'dev',
  key: createHash('sha256').update('f4d-development-only-key').digest(),
});

export const parseCipherKey = (id: string, base64: string): CipherKey => ({
  id,
  key: Buffer.from(base64, 'base64'),
});
