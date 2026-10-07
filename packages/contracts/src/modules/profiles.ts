import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { cursorPage, cursorQuerySchema } from '../common/pagination.js';
import { defineRoute } from '../http/route.js';
import { levelSchema, projectTypeSchema, stackSlugSchema } from './catalog.js';

/** Ciclo do perfil de freelancer (máquina de estados no domínio da API). */
export const FreelancerProfileStatus = {
  Draft: 'DRAFT',
  PendingReview: 'PENDING_REVIEW',
  ChangesRequested: 'CHANGES_REQUESTED',
  Approved: 'APPROVED',
} as const;
export type FreelancerProfileStatus =
  (typeof FreelancerProfileStatus)[keyof typeof FreelancerProfileStatus];
export const freelancerProfileStatusSchema = z.enum(
  Object.values(FreelancerProfileStatus) as [FreelancerProfileStatus, ...FreelancerProfileStatus[]],
);

export const PROFILE_LIMITS = {
  headlineMin: 10,
  headlineMax: 80,
  bioMinToSubmit: 100,
  bioMax: 2000,
  stacksMax: 15,
  portfolioMax: 12,
} as const;

const httpsUrl = z.url({ protocol: /^https$/, error: 'Use um link https://' }).max(500);
const hostUrl = (hosts: string[], label: string) =>
  httpsUrl.refine(
    (value) => {
      const host = new URL(value).hostname.replace(/^www\./, '');
      return hosts.includes(host);
    },
    { error: `Informe um link do ${label}.` },
  );

export const profileLinksSchema = z
  .object({
    github: hostUrl(['github.com'], 'GitHub').optional(),
    linkedin: hostUrl(['linkedin.com'], 'LinkedIn').optional(),
    website: httpsUrl.optional(),
  })
  .strict()
  .meta({ id: 'ProfileLinks' });

export const portfolioItemInputSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().min(20).max(600),
    url: httpsUrl.optional(),
    stacks: z.array(stackSlugSchema).max(10).default([]),
  })
  .strict()
  .meta({ id: 'PortfolioItemInput' });

export const portfolioItemSchema = portfolioItemInputSchema
  .extend({ id: z.uuid() })
  .meta({ id: 'PortfolioItem' });

export const freelancerProfileInputSchema = z
  .object({
    headline: z.string().trim().max(PROFILE_LIMITS.headlineMax),
    bio: z.string().trim().max(PROFILE_LIMITS.bioMax),
    stacks: z.array(stackSlugSchema).max(PROFILE_LIMITS.stacksMax),
    projectTypes: z.array(projectTypeSchema).max(5),
    links: profileLinksSchema,
    available: z.boolean(),
  })
  .strict()
  .meta({ id: 'FreelancerProfileInput' });

export const freelancerProfileSchema = freelancerProfileInputSchema
  .extend({
    userId: z.uuid(),
    displayName: z.string(),
    status: freelancerProfileStatusSchema,
    level: levelSchema.nullable(),
    portfolio: z.array(portfolioItemSchema),
    /** Motivo do último pedido de ajustes (visível ao freelancer). */
    reviewNote: z.string().nullable(),
    /** Itens que faltam para enviar à análise (vazio = pode enviar). */
    missingForSubmission: z.array(z.string()),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'FreelancerProfile' });

/** Visão pública (para clientes): sem e-mail, sem status interno, só perfis aprovados. */
export const publicFreelancerProfileSchema = freelancerProfileSchema
  .pick({
    userId: true,
    displayName: true,
    headline: true,
    bio: true,
    stacks: true,
    projectTypes: true,
    links: true,
    portfolio: true,
    level: true,
  })
  .meta({ id: 'PublicFreelancerProfile' });

export const clientProfileSchema = z
  .object({
    userId: z.uuid(),
    companyName: z.string().nullable(),
  })
  .meta({ id: 'ClientProfile' });

export const adminFreelancerSummarySchema = z
  .object({
    userId: z.uuid(),
    displayName: z.string(),
    email: z.string(),
    headline: z.string(),
    status: freelancerProfileStatusSchema,
    level: levelSchema.nullable(),
    stacks: z.array(stackSlugSchema),
    submittedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'AdminFreelancerSummary' });

export const adminFreelancerDetailSchema = freelancerProfileSchema
  .extend({
    email: z.string(),
    levelHistory: z.array(
      z.object({
        from: z.string().nullable(),
        to: z.string(),
        reason: z.string(),
        changedAt: z.iso.datetime(),
      }),
    ),
  })
  .meta({ id: 'AdminFreelancerDetail' });

export type FreelancerProfile = z.infer<typeof freelancerProfileSchema>;
export type FreelancerProfileInput = z.infer<typeof freelancerProfileInputSchema>;
export type PortfolioItemInput = z.infer<typeof portfolioItemInputSchema>;
export type PublicFreelancerProfile = z.infer<typeof publicFreelancerProfileSchema>;
export type ClientProfile = z.infer<typeof clientProfileSchema>;
export type AdminFreelancerSummary = z.infer<typeof adminFreelancerSummarySchema>;
export type AdminFreelancerDetail = z.infer<typeof adminFreelancerDetailSchema>;

const userIdParams = z.object({ userId: z.uuid() });
const itemParams = z.object({ itemId: z.uuid() });
const freelancerWrite = { permission: Permission.ProfileFreelancerWrite } as const;
const review = { permission: Permission.AdminFreelancersReview } as const;

export const profileRoutes = {
  getMyFreelancerProfile: defineRoute({
    method: 'get',
    path: '/v1/me/freelancer-profile',
    operationId: 'getMyFreelancerProfile',
    summary: 'Perfil de freelancer do usuário (criado como rascunho no primeiro acesso).',
    tags: ['profiles'],
    auth: freelancerWrite,
    request: {},
    responses: { 200: freelancerProfileSchema },
  }),
  updateMyFreelancerProfile: defineRoute({
    method: 'put',
    path: '/v1/me/freelancer-profile',
    operationId: 'updateMyFreelancerProfile',
    summary: 'Atualiza os dados do perfil (rascunho pode ficar incompleto).',
    tags: ['profiles'],
    auth: freelancerWrite,
    request: { body: freelancerProfileInputSchema },
    responses: { 200: freelancerProfileSchema },
  }),
  addPortfolioItem: defineRoute({
    method: 'post',
    path: '/v1/me/freelancer-profile/portfolio',
    operationId: 'addPortfolioItem',
    summary: 'Adiciona um item ao portfólio.',
    tags: ['profiles'],
    auth: freelancerWrite,
    request: { body: portfolioItemInputSchema },
    responses: { 201: freelancerProfileSchema },
  }),
  updatePortfolioItem: defineRoute({
    method: 'put',
    path: '/v1/me/freelancer-profile/portfolio/{itemId}',
    operationId: 'updatePortfolioItem',
    summary: 'Edita um item do portfólio.',
    tags: ['profiles'],
    auth: freelancerWrite,
    request: { params: itemParams, body: portfolioItemInputSchema },
    responses: { 200: freelancerProfileSchema },
  }),
  removePortfolioItem: defineRoute({
    method: 'delete',
    path: '/v1/me/freelancer-profile/portfolio/{itemId}',
    operationId: 'removePortfolioItem',
    summary: 'Remove um item do portfólio.',
    tags: ['profiles'],
    auth: freelancerWrite,
    request: { params: itemParams },
    responses: { 200: freelancerProfileSchema },
  }),
  submitFreelancerProfile: defineRoute({
    method: 'post',
    path: '/v1/me/freelancer-profile/submit',
    operationId: 'submitFreelancerProfile',
    summary: 'Envia o perfil para análise do Admin.',
    tags: ['profiles'],
    auth: freelancerWrite,
    request: {},
    responses: { 200: freelancerProfileSchema },
  }),
  getMyClientProfile: defineRoute({
    method: 'get',
    path: '/v1/me/client-profile',
    operationId: 'getMyClientProfile',
    summary: 'Perfil de cliente do usuário.',
    tags: ['profiles'],
    auth: { permission: Permission.ProfileClientWrite },
    request: {},
    responses: { 200: clientProfileSchema },
  }),
  updateMyClientProfile: defineRoute({
    method: 'put',
    path: '/v1/me/client-profile',
    operationId: 'updateMyClientProfile',
    summary: 'Atualiza o perfil de cliente.',
    tags: ['profiles'],
    auth: { permission: Permission.ProfileClientWrite },
    request: {
      body: z.object({ companyName: z.string().trim().max(120).nullable() }).strict(),
    },
    responses: { 200: clientProfileSchema },
  }),
  getPublicFreelancerProfile: defineRoute({
    method: 'get',
    path: '/v1/freelancers/{userId}',
    operationId: 'getPublicFreelancerProfile',
    summary: 'Perfil público de um freelancer aprovado.',
    tags: ['profiles'],
    auth: 'authenticated',
    request: { params: userIdParams },
    responses: { 200: publicFreelancerProfileSchema },
  }),
  adminListFreelancers: defineRoute({
    method: 'get',
    path: '/v1/admin/freelancers',
    operationId: 'adminListFreelancers',
    summary: 'Lista perfis de freelancer por status (mais antigos primeiro na fila de análise).',
    tags: ['admin', 'profiles'],
    auth: review,
    request: {
      query: cursorQuerySchema.extend({
        status: freelancerProfileStatusSchema.default('PENDING_REVIEW'),
      }),
    },
    responses: { 200: cursorPage(adminFreelancerSummarySchema) },
  }),
  adminGetFreelancer: defineRoute({
    method: 'get',
    path: '/v1/admin/freelancers/{userId}',
    operationId: 'adminGetFreelancer',
    summary: 'Perfil completo para análise, com histórico de níveis.',
    tags: ['admin', 'profiles'],
    auth: review,
    request: { params: userIdParams },
    responses: { 200: adminFreelancerDetailSchema },
  }),
  adminApproveFreelancer: defineRoute({
    method: 'post',
    path: '/v1/admin/freelancers/{userId}/approve',
    operationId: 'adminApproveFreelancer',
    summary: 'Aprova o perfil e atribui o nível (padrão: inicial).',
    tags: ['admin', 'profiles'],
    auth: review,
    request: {
      params: userIdParams,
      body: z
        .object({ levelSlug: z.string().optional(), note: z.string().trim().max(500).optional() })
        .strict(),
    },
    responses: { 200: adminFreelancerDetailSchema },
  }),
  adminRequestChanges: defineRoute({
    method: 'post',
    path: '/v1/admin/freelancers/{userId}/request-changes',
    operationId: 'adminRequestFreelancerChanges',
    summary: 'Devolve o perfil ao freelancer com o motivo.',
    tags: ['admin', 'profiles'],
    auth: review,
    request: {
      params: userIdParams,
      body: z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
    },
    responses: { 200: adminFreelancerDetailSchema },
  }),
  adminReclassifyLevel: defineRoute({
    method: 'post',
    path: '/v1/admin/freelancers/{userId}/level',
    operationId: 'adminReclassifyFreelancer',
    summary: 'Reclassifica o nível manualmente (ex.: após análise de portfólio).',
    tags: ['admin', 'profiles'],
    auth: review,
    request: {
      params: userIdParams,
      body: z
        .object({ levelSlug: z.string(), reason: z.string().trim().min(10).max(500) })
        .strict(),
    },
    responses: { 200: adminFreelancerDetailSchema },
  }),
} as const;
