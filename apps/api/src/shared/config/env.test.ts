import { describe, expect, it } from 'vitest';
import { InvalidEnvironmentError, loadEnv } from './env.js';

const valid = {
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  DATABASE_URL: 'postgres://f4d:f4d@localhost:5432/f4d',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: 'http://localhost:3000, http://localhost:3001',
};

describe('loadEnv', () => {
  it('applies defaults and parses lists', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3333);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
  });

  it('fails fast listing every invalid variable', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://x', CORS_ORIGINS: '' })).toThrow(
      InvalidEnvironmentError,
    );
    try {
      loadEnv({ ...valid, DATABASE_URL: 'mysql://x', CORS_ORIGINS: '' });
    } catch (error) {
      expect((error as Error).message).toContain('DATABASE_URL');
      expect((error as Error).message).toContain('CORS_ORIGINS');
    }
  });

  it('refuses insecure defaults in production', () => {
    try {
      loadEnv({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'false' });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('JWT_PRIVATE_KEY');
      expect(message).toContain('COOKIE_SECURE');
      expect(message).toContain('MAIL_TRANSPORT');
      expect(message).toContain('ESTIMATOR');
      expect(message).toContain('PAYMENTS_PROVIDER');
    }
  });

  it('requires the key of the chosen AI provider', () => {
    expect(() => loadEnv({ ...valid, ESTIMATOR: 'gemini' })).toThrow('GEMINI_API_KEY');
    expect(() => loadEnv({ ...valid, ESTIMATOR: 'anthropic' })).toThrow('ANTHROPIC_API_KEY');
    expect(loadEnv({ ...valid, ESTIMATOR: 'gemini', GEMINI_API_KEY: 'k' }).GEMINI_MODEL).toBe(
      'gemini-3.8-flash',
    );
  });

  it('requires Stripe keys to use the real payment provider', () => {
    expect(() => loadEnv({ ...valid, PAYMENTS_PROVIDER: 'stripe' })).toThrow(
      'STRIPE_WEBHOOK_SECRET',
    );
    expect(
      loadEnv({
        ...valid,
        PAYMENTS_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
        STRIPE_PAYMENT_METHODS: 'card, pix',
      }).STRIPE_PAYMENT_METHODS,
    ).toEqual(['card', 'pix']);
  });

  it('rejects wildcard CORS', () => {
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: '*' })).toThrow(InvalidEnvironmentError);
  });
  it('treats empty values (VAR= in .env) as not set', () => {
    const env = loadEnv({
      ...valid,
      SENTRY_DSN: '',
      FIELD_ENCRYPTION_KEY: '  ',
      GITHUB_CLIENT_ID: '',
      RATE_LIMIT_PER_MINUTE: '',
    });
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.FIELD_ENCRYPTION_KEY).toBeUndefined();
    expect(env.RATE_LIMIT_PER_MINUTE).toBe(120);
  });
});
