import { Secret, TOTP } from 'otpauth';
import type { TotpService } from '../application/ports.js';

const ISSUER = 'Freelas 4 Devs';
const PERIOD_SECONDS = 30;

/** TOTP RFC 6238 (SHA-1, 6 dígitos, 30 s) — o padrão aceito por todos os apps autenticadores. */
export class OtpAuthTotpService implements TotpService {
  generateSecret(): string {
    return new Secret({ size: 20 }).base32;
  }

  provisioningUri(secret: string, accountLabel: string): string {
    return this.totp(secret, accountLabel).toString();
  }

  matchStep(secret: string, code: string, now: Date): number | null {
    const token = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(token)) return null;
    const totp = this.totp(secret);
    const timestamp = now.getTime();
    // Janela de ±1 passo tolera relógios levemente dessincronizados.
    const delta = totp.validate({ token, timestamp, window: 1 });
    return delta === null ? null : totp.counter({ timestamp }) + delta;
  }

  private totp(secret: string, label = 'conta'): TOTP {
    return new TOTP({
      issuer: ISSUER,
      label,
      algorithm: 'SHA1',
      digits: 6,
      period: PERIOD_SECONDS,
      secret: Secret.fromBase32(secret),
    });
  }
}
