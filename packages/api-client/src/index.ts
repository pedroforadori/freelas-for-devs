import type { ProblemDetails } from '@f4d/contracts';
import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { paths } from './schema.js';

export type { paths } from './schema.js';
export type ApiClient = Client<paths>;

export const CSRF_COOKIE = 'f4d_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiClientOptions {
  baseUrl: string;
  /** Web: lê o token CSRF do cookie não-httpOnly (double-submit). Mobile: omitir. */
  getCsrfToken?: () => string | undefined;
  /** Mobile: token de acesso enviado como Bearer. Web: omitir (cookie httpOnly). */
  getAccessToken?: () => string | undefined;
  fetch?: typeof fetch;
}

/** Lê um cookie no browser; retorna `undefined` fora dele (SSR). */
export const readCookie = (name: string): string | undefined => {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
};

export const createApiClient = (options: ApiClientOptions): ApiClient => {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: 'include',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const auth: Middleware = {
    onRequest({ request }) {
      const csrf = options.getCsrfToken?.();
      if (csrf && MUTATING.has(request.method)) request.headers.set(CSRF_HEADER, csrf);
      const token = options.getAccessToken?.();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      return request;
    },
  };
  client.use(auth);
  return client;
};

/** Erro lançado por `unwrap` com o Problem Details (RFC 9457) devolvido pela API. */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get code(): ProblemDetails['code'] {
    return this.problem.code;
  }
}

const isProblem = (value: unknown): value is ProblemDetails =>
  typeof value === 'object' && value !== null && 'code' in value && 'status' in value;

/**
 * Converte a resposta do openapi-fetch em valor ou `ApiError` — formato que o TanStack Query
 * espera (`queryFn` que lança em caso de erro).
 */
export const unwrap = async <T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> => {
  const { data, error, response } = await call;
  if (error === undefined && response.ok) return data as T;
  throw new ApiError(
    isProblem(error)
      ? error
      : {
          type: 'about:blank',
          title: 'Erro de rede',
          status: response.status,
          code: 'INTERNAL_ERROR',
        },
  );
};
