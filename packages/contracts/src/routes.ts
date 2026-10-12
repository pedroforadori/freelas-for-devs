import type { RouteContract } from './http/route.js';
import { authRoutes } from './modules/auth.js';
import { catalogRoutes } from './modules/catalog.js';
import { contractRoutes } from './modules/contracts.js';
import { distributionRoutes } from './modules/distribution.js';
import { fileRoutes } from './modules/files.js';
import { healthRoutes } from './modules/health.js';
import { leadRoutes } from './modules/leads.js';
import { disputeRoutes } from './modules/disputes.js';
import { messagingRoutes } from './modules/messaging.js';
import { reputationRoutes } from './modules/reputation.js';
import { profileRoutes } from './modules/profiles.js';
import { projectRoutes } from './modules/projects.js';
import { settingRoutes } from './modules/settings.js';

/** Registro de todas as rotas públicas da API. Cada módulo novo adiciona seu grupo aqui. */
export const apiRoutes = {
  health: healthRoutes,
  auth: authRoutes,
  catalog: catalogRoutes,
  profiles: profileRoutes,
  files: fileRoutes,
  leads: leadRoutes,
  projects: projectRoutes,
  settings: settingRoutes,
  distribution: distributionRoutes,
  contracts: contractRoutes,
  messaging: messagingRoutes,
  disputes: disputeRoutes,
  reputation: reputationRoutes,
} as const;

export const allRoutes = (): RouteContract[] =>
  Object.values(apiRoutes).flatMap((group) => Object.values(group) as RouteContract[]);
