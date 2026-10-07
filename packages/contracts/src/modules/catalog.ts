import { z } from 'zod';
import { defineRoute } from '../http/route.js';

/** Tipos de projeto atendidos pela plataforma (compatibilidade freelancer ↔ projeto na fila). */
export const ProjectType = {
  Site: 'SITE',
  Ecommerce: 'ECOMMERCE',
  App: 'APP',
  System: 'SYSTEM',
  Other: 'OTHER',
} as const;
export type ProjectType = (typeof ProjectType)[keyof typeof ProjectType];
export const projectTypeSchema = z.enum(
  Object.values(ProjectType) as [ProjectType, ...ProjectType[]],
);

export const PROJECT_TYPE_LABELS: Readonly<Record<ProjectType, string>> = {
  SITE: 'Site',
  ECOMMERCE: 'Loja virtual',
  APP: 'App',
  SYSTEM: 'Sistema / painel',
  OTHER: 'Outro',
};

export const stackSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9.+#-]{0,39}$/);

export const stackSchema = z
  .object({
    slug: stackSlugSchema,
    name: z.string(),
    category: z.enum([
      'frontend',
      'backend',
      'mobile',
      'cms',
      'ecommerce',
      'database',
      'devops',
      'design',
    ]),
  })
  .meta({ id: 'Stack' });

export const levelSchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    rank: z.number().int().positive(),
  })
  .meta({ id: 'Level' });

export type Stack = z.infer<typeof stackSchema>;
export type Level = z.infer<typeof levelSchema>;

export const catalogRoutes = {
  stacks: defineRoute({
    method: 'get',
    path: '/v1/catalog/stacks',
    operationId: 'listStacks',
    summary: 'Catálogo de stacks selecionáveis no perfil e nos projetos.',
    tags: ['catalog'],
    auth: 'public',
    request: {},
    responses: { 200: z.object({ items: z.array(stackSchema) }) },
  }),
  levels: defineRoute({
    method: 'get',
    path: '/v1/catalog/levels',
    operationId: 'listLevels',
    summary: 'Níveis de freelancer, do inicial ao mais alto.',
    tags: ['catalog'],
    auth: 'public',
    request: {},
    responses: { 200: z.object({ items: z.array(levelSchema) }) },
  }),
} as const;
