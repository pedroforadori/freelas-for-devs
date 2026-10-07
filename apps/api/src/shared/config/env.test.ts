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
    }
  });

  it('rejects wildcard CORS', () => {
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: '*' })).toThrow(InvalidEnvironmentError);
  });
});
