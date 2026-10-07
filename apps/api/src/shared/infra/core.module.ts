import { Global, Logger, Module } from '@nestjs/common';
import { AUDIT_LOGGER } from '../application/audit-log.js';
import { SECRET_CIPHER } from '../application/secret-cipher.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { systemClock } from '../kernel/clock.js';
import { DrizzleAuditLogger } from './audit/drizzle-audit.logger.js';
import { AesGcmCipher, developmentCipherKey, parseCipherKey } from './crypto/aes-gcm.cipher.js';
import { DatabaseContext } from './database/database-context.js';
import { ID_GENERATOR, UuidV7Generator } from './id/uuid-v7.generator.js';

export const CLOCK = Symbol('CLOCK');

/** Serviços transversais disponíveis a todos os módulos: relógio, ids, auditoria e cifra de campos. */
@Global()
@Module({
  providers: [
    { provide: CLOCK, useValue: systemClock },
    { provide: ID_GENERATOR, useClass: UuidV7Generator },
    {
      provide: AUDIT_LOGGER,
      inject: [DatabaseContext, ID_GENERATOR],
      useFactory: (ctx: DatabaseContext, ids: UuidV7Generator) => new DrizzleAuditLogger(ctx, ids),
    },
    {
      provide: SECRET_CIPHER,
      inject: [ENV],
      useFactory: (env: Env) => {
        const previous = env.FIELD_ENCRYPTION_PREVIOUS_KEYS.map((k) => parseCipherKey(k.id, k.key));
        if (env.FIELD_ENCRYPTION_KEY) {
          return new AesGcmCipher(
            parseCipherKey(env.FIELD_ENCRYPTION_KEY_ID, env.FIELD_ENCRYPTION_KEY),
            previous,
          );
        }
        // O schema de env impede chegar aqui em produção.
        new Logger('Crypto').warn('FIELD_ENCRYPTION_KEY ausente: usando chave de desenvolvimento.');
        return new AesGcmCipher(developmentCipherKey(), previous);
      },
    },
  ],
  exports: [CLOCK, ID_GENERATOR, AUDIT_LOGGER, SECRET_CIPHER],
})
export class CoreModule {}
