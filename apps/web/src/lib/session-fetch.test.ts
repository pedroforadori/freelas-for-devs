import { describe, expect, it, vi } from 'vitest';
import { createSessionFetch } from './session-fetch';

const response = (status: number) => new Response(status === 204 ? null : '{}', { status });

describe('createSessionFetch', () => {
  it('refreshes once on 401 and replays the original request with its body', async () => {
    const seen: string[] = [];
    let authorized = false;
    const base = vi.fn(async (request: Request) => {
      seen.push(`${request.method} ${new URL(request.url).pathname} ${await request.text()}`);
      return response(authorized ? 200 : 401);
    });
    const refresh = vi.fn(() => {
      authorized = true;
      return Promise.resolve(response(200));
    });
    const sessionFetch = createSessionFetch(base as unknown as typeof fetch, {
      refresh,
      onSessionExpired: vi.fn(),
    });

    const result = await sessionFetch('http://api.test/v1/me/freelancer-profile', {
      method: 'PUT',
      body: '{"a":1}',
    });

    expect(result.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      'PUT /v1/me/freelancer-profile {"a":1}',
      'PUT /v1/me/freelancer-profile {"a":1}',
    ]);
  });

  it('shares a single refresh among concurrent 401s', async () => {
    let authorized = false;
    const base = vi.fn(() => Promise.resolve(response(authorized ? 200 : 401)));
    const refresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      authorized = true;
      return response(200);
    });
    const sessionFetch = createSessionFetch(base, {
      refresh,
      onSessionExpired: vi.fn(),
    });

    const results = await Promise.all([1, 2, 3].map(() => sessionFetch('http://api.test/v1/me')));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('treats 409 from refresh (another tab renewed) as success', async () => {
    let calls = 0;
    const base = vi.fn(() => Promise.resolve(response((calls += 1) === 1 ? 401 : 200)));
    const sessionFetch = createSessionFetch(base, {
      refresh: () => Promise.resolve(response(409)),
      onSessionExpired: vi.fn(),
    });
    expect((await sessionFetch('http://api.test/v1/me')).status).toBe(200);
  });

  it('reports an expired session and never refreshes for auth routes', async () => {
    const onSessionExpired = vi.fn();
    const refresh = vi.fn(() => Promise.resolve(response(401)));
    const sessionFetch = createSessionFetch(() => Promise.resolve(response(401)), {
      refresh,
      onSessionExpired,
    });

    expect((await sessionFetch('http://api.test/v1/me')).status).toBe(401);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);

    await sessionFetch('http://api.test/v1/auth/login', { method: 'POST', body: '{}' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
