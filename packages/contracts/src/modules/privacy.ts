import { z } from 'zod';
import { defineRoute, noContent } from '../http/route.js';

/**
 * Direitos do titular (LGPD art. 18): acesso/portabilidade (exportação) e eliminação (exclusão
 * da conta por anonimização). Registros financeiros e de contratos são mantidos pelo prazo legal,
 * sem identificar a pessoa.
 */

const records = z.array(z.record(z.string(), z.unknown()));

export const dataExportSchema = z
  .object({
    format: z.literal('freelas4devs-export/v1'),
    generatedAt: z.iso.datetime(),
    account: z.record(z.string(), z.unknown()),
    loginProviders: records,
    clientProfile: z.record(z.string(), z.unknown()).nullable(),
    freelancerProfile: z.record(z.string(), z.unknown()).nullable(),
    portfolio: records,
    levelHistory: records,
    reputation: z.record(z.string(), z.unknown()).nullable(),
    projects: records,
    invitations: records,
    contracts: records,
    ratings: records,
    disputes: records,
    messagesSent: records,
    files: records,
    waitlist: records,
    securityEvents: records,
  })
  .meta({ id: 'DataExport' });

export const DeletionBlocker = {
  OpenContracts: 'OPEN_CONTRACTS',
  OpenProjects: 'OPEN_PROJECTS',
  Admin: 'ADMIN',
} as const;
export type DeletionBlocker = (typeof DeletionBlocker)[keyof typeof DeletionBlocker];

export const deletionCheckSchema = z
  .object({
    canDelete: z.boolean(),
    blockers: z.array(
      z.object({
        kind: z.enum(['OPEN_CONTRACTS', 'OPEN_PROJECTS', 'ADMIN']),
        message: z.string(),
        count: z.number().int(),
      }),
    ),
    /** A conta tem senha (pedida para confirmar) ou só login social. */
    hasPassword: z.boolean(),
  })
  .meta({ id: 'DeletionCheck' });

export const DELETE_CONFIRMATION = 'EXCLUIR MINHA CONTA';

export const deleteAccountSchema = z
  .object({
    confirmation: z.literal(DELETE_CONFIRMATION, {
      error: `Digite ${DELETE_CONFIRMATION} para confirmar.`,
    }),
    password: z.string().max(200).optional(),
  })
  .strict()
  .meta({ id: 'DeleteAccount' });

export type DataExport = z.infer<typeof dataExportSchema>;
export type DeletionCheck = z.infer<typeof deletionCheckSchema>;

export const privacyRoutes = {
  exportMyData: defineRoute({
    method: 'get',
    path: '/v1/me/data-export',
    operationId: 'exportMyData',
    summary: 'Todos os seus dados pessoais em JSON (portabilidade, LGPD art. 18).',
    tags: ['privacy'],
    auth: 'authenticated',
    request: {},
    responses: { 200: dataExportSchema },
  }),
  checkAccountDeletion: defineRoute({
    method: 'get',
    path: '/v1/me/deletion-check',
    operationId: 'checkAccountDeletion',
    summary: 'Se a conta pode ser excluída agora e o que impede.',
    tags: ['privacy'],
    auth: 'authenticated',
    request: {},
    responses: { 200: deletionCheckSchema },
  }),
  deleteMyAccount: defineRoute({
    method: 'post',
    path: '/v1/me/delete',
    operationId: 'deleteMyAccount',
    summary: 'Exclui a conta: dados pessoais apagados ou anonimizados; sessões encerradas.',
    tags: ['privacy'],
    auth: 'authenticated',
    request: { body: deleteAccountSchema },
    responses: { 204: noContent },
  }),
} as const;
