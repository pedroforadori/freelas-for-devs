import { describe, expect, it } from 'vitest';
import { CheckReadiness, type HealthIndicator } from './check-readiness.js';

const indicator = (
  name: string,
  behavior: 'up' | 'down' | 'throws' | 'hangs',
): HealthIndicator => ({
  name,
  isHealthy: () => {
    switch (behavior) {
      case 'up':
        return Promise.resolve(true);
      case 'down':
        return Promise.resolve(false);
      case 'throws':
        return Promise.reject(new Error('connection refused'));
      case 'hangs':
        return new Promise<boolean>(() => undefined);
    }
  },
});

describe('CheckReadiness', () => {
  it('is ready when every dependency is up', async () => {
    const report = await new CheckReadiness([
      indicator('postgres', 'up'),
      indicator('redis', 'up'),
    ]).execute();
    expect(report).toEqual({ status: 'ready', checks: { postgres: 'up', redis: 'up' } });
  });

  it('degrades when a dependency is down or throws', async () => {
    const report = await new CheckReadiness([
      indicator('postgres', 'throws'),
      indicator('redis', 'down'),
    ]).execute();
    expect(report).toEqual({ status: 'degraded', checks: { postgres: 'down', redis: 'down' } });
  });

  it('treats a hanging dependency as down after the timeout', async () => {
    const report = await new CheckReadiness([indicator('postgres', 'hangs')], 20).execute();
    expect(report.checks.postgres).toBe('down');
  });
});
