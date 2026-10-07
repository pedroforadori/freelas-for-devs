import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, WEB_ORIGIN } from '../support/test-app.js';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t?.close();
});

describe('HTTP edge', () => {
  it('serves liveness from the contract', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', version: '1.2.3-test' });
  });

  it('reports readiness and degrades with 503 when a dependency is down', async () => {
    const ready = await t.app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready', checks: { postgres: 'up', redis: 'up' } });

    t.dependencies.redis = false;
    const degraded = await t.app.inject({ method: 'GET', url: '/v1/health/ready' });
    t.dependencies.redis = true;
    expect(degraded.statusCode).toBe(503);
    expect(degraded.json()).toEqual({
      status: 'degraded',
      checks: { postgres: 'up', redis: 'down' },
    });
  });

  it('answers unknown routes with RFC 9457 problem details and a request id', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/nope',
      headers: { 'x-request-id': 'req-12345678' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404, code: 'NOT_FOUND', requestId: 'req-12345678' });
  });

  it('echoes a safe request id and replaces an unsafe one', async () => {
    const echoed = await t.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'abc-12345678' },
    });
    expect(echoed.headers['x-request-id']).toBe('abc-12345678');

    const unsafe = await t.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'bad id\ninjected' },
    });
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sets security headers', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS with credentials only for configured origins', async () => {
    const allowed = await t.app.inject({
      method: 'OPTIONS',
      url: '/v1/health',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await t.app.inject({
      method: 'OPTIONS',
      url: '/v1/health',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves the OpenAPI document outside production', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ openapi: '3.1.0', info: { title: 'Freelas 4 Devs API' } });
  });
});
