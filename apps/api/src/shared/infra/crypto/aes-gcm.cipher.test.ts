import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmCipher } from './aes-gcm.cipher.js';

const key = (id: string) => ({ id, key: randomBytes(32) });

describe('AesGcmCipher', () => {
  it('round-trips and never repeats ciphertext for the same input', () => {
    const cipher = new AesGcmCipher(key('k1'));
    const a = cipher.encrypt('JBSWY3DPEHPK3PXP');
    const b = cipher.encrypt('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(a.startsWith('k1.')).toBe(true);
    expect(cipher.decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detects tampering', () => {
    const cipher = new AesGcmCipher(key('k1'));
    const [kid, iv, tag, ct] = cipher.encrypt('segredo').split('.');
    const flipped = Buffer.from(ct!, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(() => cipher.decrypt([kid, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });

  it('decrypts values from a previous key after rotation', () => {
    const old = key('k1');
    const legacy = new AesGcmCipher(old).encrypt('segredo');
    const rotated = new AesGcmCipher(key('k2'), [old]);
    expect(rotated.decrypt(legacy)).toBe('segredo');
    expect(rotated.encrypt('novo').startsWith('k2.')).toBe(true);
  });

  it('rejects keys of the wrong size', () => {
    expect(() => new AesGcmCipher({ id: 'k1', key: randomBytes(16) })).toThrow('32 bytes');
  });
});
