import { z } from 'zod';
import { defineRoute, noContent } from '../http/route.js';
import { emailSchema } from './auth.js';
import { selfAssignableRoleSchema } from '../auth/permissions.js';

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
} as const;
