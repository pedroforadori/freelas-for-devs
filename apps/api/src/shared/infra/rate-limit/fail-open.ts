import { Logger } from '@nestjs/common';

const REPORT_INTERVAL_MS = 30_000;

/**
 * Proteções auxiliares (rate limit, bloqueio de login) não derrubam a API quando o Redis cai:
 * a operação segue sem a proteção e o erro é logado (no máximo 1x a cada 30 s por componente).
 * A queda já aparece no readiness, que dispara o alerta.
 */
export class FailOpen {
  private readonly logger: Logger;
  private lastReportAt = 0;

  constructor(component: string) {
    this.logger = new Logger(component);
  }

  async run<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const now = Date.now();
      if (now - this.lastReportAt >= REPORT_INTERVAL_MS) {
        this.lastReportAt = now;
        this.logger.error(
          { err: error instanceof Error ? error.message : String(error) },
          'Redis indisponível: proteção desativada temporariamente (fail-open)',
        );
      }
      return fallback;
    }
  }
}
