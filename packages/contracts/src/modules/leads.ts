import { z } from 'zod';
import { defineRoute, noContent } from '../http/route.js';
import { emailSchema } from './auth.js';
import { Permission, selfAssignableRoleSchema } from '../auth/permissions.js';

/** Versão do texto de consentimento exibido no formulário (LGPD: provar o que foi aceito). */
export const LEAD_CONSENT_VERSION = '2026-10-v1';

const utmValue = z.string().trim().max(100).optional();

export const createLeadRequestSchema = z
  .object({
    profile: selfAssignableRoleSchema,
    name: z.string().trim().min(2, { error: 'Informe seu nome.' }).max(80),
    email: emailSchema,
    /** Só para freelancers: principal stack (texto livre, curto). */
    mainStack: z.string().trim().max(60).optional(),
    consent: z.literal(true, { error: 'É preciso concordar para entrar na lista.' }),
    consentVersion: z.string().max(20),
    utm: z
      .object({
        source: utmValue,
        medium: utmValue,
        campaign: utmValue,
        term: utmValue,
        content: utmValue,
      })
      .strict()
      .optional(),
    /** Token do Cloudflare Turnstile (anti-bot), quando habilitado. */
    captchaToken: z.string().max(4096).optional(),
    /** Honeypot: campo invisível; humanos deixam vazio. */
    website: z.string().max(200).optional(),
  })
  .strict()
  .meta({ id: 'CreateLeadRequest' });

export type CreateLeadRequest = z.infer<typeof createLeadRequestSchema>;

/** Lista de espera vista pelo Admin, com a situação do convite para o beta fechado. */
export const betaWaitlistEntrySchema = z
  .object({
    email: z.string(),
    name: z.string(),
    profiles: z.array(selfAssignableRoleSchema),
    mainStack: z.string().nullable(),
    joinedAt: z.iso.datetime(),
    invitedAt: z.iso.datetime().nullable(),
    /** Já criou a conta na plataforma. */
    registered: z.boolean(),
  })
  .meta({ id: 'BetaWaitlistEntry' });

export const betaOverviewSchema = z
  .object({
    signupMode: z.enum(['OPEN', 'INVITE_ONLY']),
    waitlist: z.array(betaWaitlistEntrySchema),
    /** Convidados que não vieram da lista de espera (convite direto por e-mail). */
    directInvites: z.array(
      z.object({ email: z.string(), invitedAt: z.iso.datetime(), registered: z.boolean() }),
    ),
  })
  .meta({ id: 'BetaOverview' });

export const inviteToBetaSchema = z
  .object({ emails: z.array(emailSchema).min(1).max(50) })
  .strict()
  .meta({ id: 'InviteToBeta' });

export type BetaOverview = z.infer<typeof betaOverviewSchema>;
export type BetaWaitlistEntry = z.infer<typeof betaWaitlistEntrySchema>;

export const leadRoutes = {
  create: defineRoute({
    method: 'post',
    path: '/v1/leads',
    operationId: 'createLead',
    summary:
      'Entra na lista de espera (landing). Sempre 202: não revela se o e-mail já estava na lista.',
    tags: ['leads'],
    auth: 'public',
    request: { body: createLeadRequestSchema },
    responses: { 202: noContent },
  }),
  adminBetaOverview: defineRoute({
    method: 'get',
    path: '/v1/admin/beta',
    operationId: 'adminBetaOverview',
    summary: 'Modo de cadastro, lista de espera e convites do beta fechado.',
    tags: ['admin', 'leads'],
    auth: { permission: Permission.AdminUsersRead },
    request: {},
    responses: { 200: betaOverviewSchema },
  }),
  adminInviteToBeta: defineRoute({
    method: 'post',
    path: '/v1/admin/beta/invites',
    operationId: 'adminInviteToBeta',
    summary: 'Convida e-mails para o beta (libera o cadastro e envia o convite).',
    tags: ['admin', 'leads'],
    auth: { permission: Permission.AdminSettingsWrite },
    request: { body: inviteToBetaSchema },
    responses: { 200: z.object({ invited: z.number().int() }) },
  }),
} as const;
