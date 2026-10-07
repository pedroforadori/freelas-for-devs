import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, unwrap } from './index.js';

const recordingFetch = () => {
  const requests: Request[] = [];
  const fetchImpl = (input: Request) => {
    requests.push(input);
    return Promise.resolve(
      new Response(JSON.stringify({ status: 'ok', version: '1.0.0', uptimeSeconds: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { requests, fetchImpl: fetchImpl as typeof fetch };
};

describe('createApiClient', () => {
  it('calls typed routes and unwraps data', async () => {
    const { fetchImpl, requests } = recordingFetch();
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: fetchImpl });

    const health = await unwrap(api.GET('/v1/health'));
    expect(health.status).toBe('ok');
    expect(requests[0]?.url).toBe('http://api.test/v1/health');
  });

  it('sends the bearer token when provided (mobile)', async () => {
    const { fetchImpl, requests } = recordingFetch();
    const api = createApiClient({
      baseUrl: 'http://api.test',
      fetch: fetchImpl,
      getAccessToken: () => 'tkn',
    });
    await api.GET('/v1/health');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer tkn');
  });

  it('turns problem+json into ApiError with a stable code', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ type: 'about:blank', title: 'Conflito', status: 409, code: 'CONFLICT' }),
          {
            status: 409,
            headers: { 'content-type': 'application/problem+json' },
          },
        ),
      )) as typeof fetch;
    const api = createApiClient({ baseUrl: 'http://api.test', fetch: fetchImpl });

    const failure = unwrap(api.GET('/v1/health'));
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
