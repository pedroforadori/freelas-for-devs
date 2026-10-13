/**
 * Inicializa o Sentry antes de qualquer outro import (exigência da instrumentação via OpenTelemetry).
 * Sem SENTRY_DSN, é um no-op — desenvolvimento local não envia nada.
 */
import './shared/config/dotenv.js';
import * as Sentry from '@sentry/nestjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // LGPD: nunca enviar dados do usuário, cookies, headers, corpos ou query strings.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}
