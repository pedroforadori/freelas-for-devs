import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponseObject,
} from 'zod-openapi';
import { problemDetailsSchema } from './common/problem.js';
import { noContent, type RouteContract } from './http/route.js';
import { allRoutes } from './routes.js';

const JSON_MEDIA = 'application/json';
const PROBLEM_MEDIA = 'application/problem+json';

const toOperation = (route: RouteContract): ZodOpenApiOperationObject => {
  const responses: Record<string, ZodOpenApiResponseObject> = {};
  for (const [status, schema] of Object.entries(route.responses)) {
    responses[status] =
      schema === noContent
        ? { description: `HTTP ${status} (sem conteúdo)` }
        : { description: `HTTP ${status}`, content: { [JSON_MEDIA]: { schema } } };
  }
  responses.default = {
    description: 'Erro (RFC 9457)',
    content: { [PROBLEM_MEDIA]: { schema: problemDetailsSchema } },
  };

  const operation: ZodOpenApiOperationObject = {
    operationId: route.operationId,
    summary: route.summary,
    tags: [...route.tags],
    responses,
  };
  if (route.request.params || route.request.query) {
    operation.requestParams = {
      ...(route.request.params ? { path: route.request.params } : {}),
      ...(route.request.query ? { query: route.request.query } : {}),
    };
  }
  if (route.request.body) {
    operation.requestBody = { content: { [JSON_MEDIA]: { schema: route.request.body } } };
  }
  if (route.auth !== 'public') {
    operation.security = [{ cookieAuth: [] }, { bearerAuth: [] }];
  }
  return operation;
};

export type OpenApiDocument = ReturnType<typeof createDocument>;

export const buildOpenApiDocument = (): OpenApiDocument => {
  const paths: ZodOpenApiPathsObject = {};
  for (const route of allRoutes()) {
    paths[route.path] = { ...paths[route.path], [route.method]: toOperation(route) };
  }

  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'Freelas 4 Devs API',
      version: '1.0.0',
      description: 'API da plataforma Freelas 4 Devs. Erros seguem RFC 9457 (problem+json).',
    },
    servers: [{ url: 'https://api.freelas4devs.com.br' }, { url: 'http://localhost:3333' }],
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: '__Host-f4d_at' },
        csrfHeader: { type: 'apiKey', in: 'header', name: 'x-csrf-token' },
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    paths,
  });
};
