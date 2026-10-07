import { describe, expect, it } from 'vitest';
import { toRouterPath } from './http/route.js';
import { buildOpenApiDocument } from './openapi.js';
import { allRoutes } from './routes.js';

describe('route registry', () => {
  it('has unique operationIds', () => {
    const ids = allRoutes().map((route) => route.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique method + path pairs', () => {
    const keys = allRoutes().map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('versions every path', () => {
    for (const route of allRoutes()) expect(route.path).toMatch(/^\/v\d+\//);
  });

  it('converts OpenAPI path params to router params', () => {
    expect(toRouterPath('/v1/projects/{projectId}/proposals/{id}')).toBe(
      '/v1/projects/:projectId/proposals/:id',
    );
  });

  it('builds a valid OpenAPI 3.1 document with every route', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    for (const route of allRoutes()) {
      expect(doc.paths?.[route.path]?.[route.method]?.operationId).toBe(route.operationId);
    }
    expect(doc.components?.schemas).toHaveProperty('ProblemDetails');
  });
});

describe('auth routes', () => {
  it('declares an access requirement on every route', () => {
    for (const route of allRoutes()) expect(route.auth).toBeDefined();
  });

  it('renders 204 responses without a body', () => {
    const doc = buildOpenApiDocument();
    const logout = doc.paths?.['/v1/auth/logout']?.post?.responses?.['204'] as {
      content?: unknown;
    };
    expect(logout.content).toBeUndefined();
  });
});
