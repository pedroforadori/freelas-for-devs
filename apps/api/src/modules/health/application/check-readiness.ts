/** Port: verificação de uma dependência externa (banco, Redis, ...). */
export interface HealthIndicator {
  readonly name: string;
  isHealthy(): Promise<boolean>;
}

export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS');

export interface ReadinessReport {
  status: 'ready' | 'degraded';
  checks: Record<string, 'up' | 'down'>;
}

/**
 * Caso de uso: o serviço está pronto para tráfego? Cada verificação tem timeout próprio
 * para que uma dependência travada não trave o probe do orquestrador.
 */
export class CheckReadiness {
  constructor(
    private readonly indicators: readonly HealthIndicator[],
    private readonly timeoutMs = 2_000,
  ) {}

  async execute(): Promise<ReadinessReport> {
    const results = await Promise.all(
      this.indicators.map(
        async (indicator) => [indicator.name, await this.probe(indicator)] as const,
      ),
    );
    const checks = Object.fromEntries(
      results.map(([name, up]) => [name, up ? 'up' : 'down'] as const),
    );
    return { status: results.every(([, up]) => up) ? 'ready' : 'degraded', checks };
  }

  private async probe(indicator: HealthIndicator): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), this.timeoutMs);
    });
    try {
      return await Promise.race([indicator.isHealthy().catch(() => false), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
