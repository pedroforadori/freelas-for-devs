import type { RouteContract } from './http/route.js';
import { healthRoutes } from './modules/health.js';

/** Registro de todas as rotas públicas da API. Cada módulo novo adiciona seu grupo aqui. */
export const apiRoutes = {
  health: healthRoutes,
} as const;

export const allRoutes = (): RouteContract[] =>
  Object.values(apiRoutes).flatMap((group) => Object.values(group) as RouteContract[]);
