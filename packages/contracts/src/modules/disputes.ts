import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { defineRoute, noContent } from '../http/route.js';
import {
  contractSchema,
  DISPUTE_LIMITS,
  disputeReasonSchema,
  disputeStatusSchema,
} from './contracts.js';

/** Fora de escopo (§4.4), disputas e abandono (§4.5) — F8. */

export const OUT_OF_SCOPE_LIMITS = {
  descriptionMin: 20,
  descriptionMax: 2000,
  amountMinCents: 1_000,
  amountMaxCents: 100_000_000,
  extraDaysMax: 180,
  /** Pedidos pendentes ao mesmo tempo por contrato. */
  pendingMax: 3,
} as const;

export const outOfScopeInputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(
        OUT_OF_SCOPE_LIMITS.descriptionMin,
        'Descreva o que foi pedido e por que não está no escopo aprovado.',
      )
      .max(OUT_OF_SCOPE_LIMITS.descriptionMax),
    amountCents: z
      .number('Informe o valor adicional.')
      .int()
      .min(OUT_OF_SCOPE_LIMITS.amountMinCents, 'O adicional mínimo é de R$ 10,00.')
      .max(OUT_OF_SCOPE_LIMITS.amountMaxCents),
    extraDays: z
      .number('Informe os dias adicionais (pode ser 0).')
      .int('Use um número inteiro de dias.')
      .min(0)
      .max(OUT_OF_SCOPE_LIMITS.extraDaysMax),
  })
  .strict()
  .meta({ id: 'OutOfScopeInput' });

export const contestOutOfScopeSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(20, 'Explique em ao menos 20 caracteres por que o pedido já estava no escopo.')
      .max(2000),
  })
  .strict()
  .meta({ id: 'ContestOutOfScope' });

export const outOfScopeRulingSchema = z
  .object({
    decision: z.enum(['IN_SCOPE', 'OUT_OF_SCOPE']),
    note: z.string().trim().min(10, 'Justifique a decisão (as partes recebem o texto).').max(2000),
  })
  .strict()
  .meta({ id: 'OutOfScopeRuling' });

export const openDisputeSchema = z
  .object({
    reason: disputeReasonSchema.exclude(['ABANDONMENT']),
    description: z
      .string()
      .trim()
      .min(
        DISPUTE_LIMITS.descriptionMin,
        `Descreva o problema em ao menos ${DISPUTE_LIMITS.descriptionMin} caracteres.`,
      )
      .max(DISPUTE_LIMITS.descriptionMax),
  })
  .strict()
  .meta({ id: 'OpenDispute' });

export const abandonContractSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(
        DISPUTE_LIMITS.descriptionMin,
        `Explique em ao menos ${DISPUTE_LIMITS.descriptionMin} caracteres o que aconteceu.`,
      )
      .max(DISPUTE_LIMITS.descriptionMax),
  })
  .strict()
  .meta({ id: 'AbandonContract' });

export const disputeStatementSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(
        DISPUTE_LIMITS.statementMin,
        `Escreva sua versão em ao menos ${DISPUTE_LIMITS.statementMin} caracteres.`,
      )
      .max(DISPUTE_LIMITS.statementMax),
    attachmentIds: z.array(z.uuid()).max(DISPUTE_LIMITS.attachmentsMax).default([]),
  })
  .strict()
  .meta({ id: 'DisputeStatement' });

export const resolveDisputeSchema = z
  .object({
    /** Quanto do valor vai para o freelancer: 0 = reembolso total, 10000 = pagamento integral. */
    freelancerShareBps: z.number().int().min(0).max(10_000),
    note: z
      .string()
      .trim()
      .min(20, 'Explique a decisão (as partes recebem o texto).')
      .max(DISPUTE_LIMITS.descriptionMax),
  })
  .strict()
  .meta({ id: 'ResolveDispute' });

export const adminDisputeSummarySchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['DISPUTE', 'ABANDONMENT']),
    status: disputeStatusSchema,
    reason: disputeReasonSchema,
    openedBy: z.enum(['CLIENT', 'FREELANCER', 'ADMIN']),
    contractId: z.uuid(),
    project: z.object({ id: z.uuid(), title: z.string() }),
    client: z.object({ userId: z.uuid(), displayName: z.string() }),
    freelancer: z.object({ userId: z.uuid(), displayName: z.string() }),
    clientTotalCents: z.number().int(),
    evidenceDeadlineAt: z.iso.datetime(),
    statements: z.number().int(),
    /** Execução aguardando algo externo (ex.: conta de recebimento do freelancer). */
    waitingFor: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'AdminDisputeSummary' });

const participationStats = z.object({
  contracts: z.number().int(),
  completed: z.number().int(),
  disputesOpened: z.number().int(),
  settledByMediation: z.number().int(),
});

export const userContractStatsSchema = z
  .object({
    asClient: participationStats,
    asFreelancer: participationStats.extend({
      abandonments: z.number().int(),
      outOfScopeFlagged: z.number().int(),
      outOfScopeRuledInScope: z.number().int(),
      /** Média da parte reconhecida nas disputas decididas (null se nenhuma). */
      averageShareBps: z.number().int().nullable(),
    }),
  })
  .meta({ id: 'UserContractStats' });

/** Como a custódia é dividida numa decisão de disputa. */
export interface Settlement {
  freelancerCents: number;
  platformFeeCents: number;
  refundCents: number;
}

/**
 * Divisão da custódia: o freelancer recebe a fração decidida do seu líquido; a plataforma fica
 * com a comissão proporcional ao que foi pago a ele (sem repasse, sem comissão); o restante
 * volta ao cliente. Arredonda para baixo — o centavo que sobra favorece o cliente.
 * Usada pela API (decisão) e pelo painel (prévia), para nunca divergirem.
 */
export const computeSettlement = (
  amounts: { freelancerNetCents: number; platformFeeCents: number; clientTotalCents: number },
  shareBps: number,
): Settlement => {
  const freelancerCents = Math.floor((amounts.freelancerNetCents * shareBps) / 10_000);
  const platformFeeCents =
    freelancerCents === 0 ? 0 : Math.floor((amounts.platformFeeCents * shareBps) / 10_000);
  return {
    freelancerCents,
    platformFeeCents,
    refundCents: amounts.clientTotalCents - freelancerCents - platformFeeCents,
  };
};

export type OutOfScopeInput = z.infer<typeof outOfScopeInputSchema>;
export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;
export type DisputeStatementInput = z.infer<typeof disputeStatementSchema>;
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
export type AdminDisputeSummary = z.infer<typeof adminDisputeSummarySchema>;
export type UserContractStats = z.infer<typeof userContractStatsSchema>;

const contractParams = z.object({ contractId: z.uuid() });
const requestParams = z.object({ contractId: z.uuid(), requestId: z.uuid() });
const participant = { permission: Permission.ContractsParticipate } as const;
const client = { permission: Permission.ProjectsClientWrite } as const;
const freelancer = { permission: Permission.ProposalsFreelancerWrite } as const;
const mediator = { permission: Permission.AdminDisputes } as const;

export const disputeRoutes = {
  flagOutOfScope: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/out-of-scope',
    operationId: 'flagOutOfScope',
    summary: 'Freelancer marca um pedido como fora do escopo e propõe valor e prazo adicionais.',
    tags: ['contracts'],
    auth: freelancer,
    request: { params: contractParams, body: outOfScopeInputSchema },
    responses: { 201: contractSchema },
  }),
  acceptOutOfScope: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/out-of-scope/{requestId}/accept',
    operationId: 'acceptOutOfScope',
    summary: 'Cliente aceita o adicional (paga à parte, em custódia).',
    tags: ['contracts'],
    auth: client,
    request: { params: requestParams },
    responses: { 200: contractSchema },
  }),
  startOutOfScopeCheckout: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/out-of-scope/{requestId}/checkout',
    operationId: 'startOutOfScopeCheckout',
    summary: 'Checkout do adicional aceito.',
    tags: ['contracts', 'payments'],
    auth: client,
    request: { params: requestParams },
    responses: { 200: z.object({ url: z.string() }) },
  }),
  withdrawOutOfScope: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/out-of-scope/{requestId}/withdraw',
    operationId: 'withdrawOutOfScope',
    summary: 'Cliente retira o pedido, ou o freelancer desiste de cobrar por ele.',
    tags: ['contracts'],
    auth: participant,
    request: { params: requestParams },
    responses: { 200: contractSchema },
  }),
  contestOutOfScope: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/out-of-scope/{requestId}/contest',
    operationId: 'contestOutOfScope',
    summary: 'Cliente contesta: entende que o pedido já estava no escopo (a mediação decide).',
    tags: ['contracts'],
    auth: client,
    request: { params: requestParams, body: contestOutOfScopeSchema },
    responses: { 200: contractSchema },
  }),
  openDispute: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/disputes',
    operationId: 'openDispute',
    summary: 'Abre uma disputa: prazos pausam e a mediação decide o destino da custódia.',
    tags: ['contracts'],
    auth: participant,
    request: { params: contractParams, body: openDisputeSchema },
    responses: { 201: contractSchema },
  }),
  abandonContract: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/abandon',
    operationId: 'abandonContract',
    summary: 'Freelancer desiste do contrato (penalidade na fila; a mediação decide a custódia).',
    tags: ['contracts'],
    auth: freelancer,
    request: { params: contractParams, body: abandonContractSchema },
    responses: { 200: contractSchema },
  }),
  addDisputeStatement: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/dispute/statements',
    operationId: 'addDisputeStatement',
    summary: 'Parte envia sua versão (texto e arquivos) enquanto a disputa está aberta.',
    tags: ['contracts'],
    auth: participant,
    request: { params: contractParams, body: disputeStatementSchema },
    responses: { 201: contractSchema },
  }),
  withdrawDispute: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/dispute/withdraw',
    operationId: 'withdrawDispute',
    summary: 'Quem abriu retira a disputa antes da análise; o contrato volta a andar.',
    tags: ['contracts'],
    auth: participant,
    request: { params: contractParams },
    responses: { 200: contractSchema },
  }),
  adminRuleOutOfScope: defineRoute({
    method: 'post',
    path: '/v1/admin/contracts/{contractId}/out-of-scope/{requestId}/ruling',
    operationId: 'adminRuleOutOfScope',
    summary: 'Mediação decide um pedido contestado: dentro ou fora do escopo.',
    tags: ['admin', 'contracts'],
    auth: mediator,
    request: { params: requestParams, body: outOfScopeRulingSchema },
    responses: { 204: noContent },
  }),
  adminListDisputes: defineRoute({
    method: 'get',
    path: '/v1/admin/disputes',
    operationId: 'adminListDisputes',
    summary: 'Disputas abertas (ou encerradas), mais antigas primeiro.',
    tags: ['admin', 'contracts'],
    auth: mediator,
    request: {
      query: z.object({ view: z.enum(['open', 'closed']).default('open') }),
    },
    responses: { 200: z.object({ items: z.array(adminDisputeSummarySchema) }) },
  }),
  adminResolveDispute: defineRoute({
    method: 'post',
    path: '/v1/admin/disputes/{disputeId}/resolve',
    operationId: 'adminResolveDispute',
    summary: 'Decide a disputa: parte do valor ao freelancer e o restante devolvido ao cliente.',
    tags: ['admin', 'contracts'],
    auth: mediator,
    request: { params: z.object({ disputeId: z.uuid() }), body: resolveDisputeSchema },
    responses: { 204: noContent },
  }),
  adminDeclareAbandonment: defineRoute({
    method: 'post',
    path: '/v1/admin/contracts/{contractId}/abandonment',
    operationId: 'adminDeclareAbandonment',
    summary: 'Declara abandono pelo freelancer (sumiu): abre a disputa e aplica a penalidade.',
    tags: ['admin', 'contracts'],
    auth: mediator,
    request: { params: contractParams, body: abandonContractSchema },
    responses: { 204: noContent },
  }),
  adminUserContractStats: defineRoute({
    method: 'get',
    path: '/v1/admin/users/{userId}/contract-stats',
    operationId: 'adminUserContractStats',
    summary: 'Histórico de contratos, disputas, abandonos e pedidos fora de escopo da pessoa.',
    tags: ['admin', 'contracts'],
    auth: { permission: Permission.AdminUsersRead },
    request: { params: z.object({ userId: z.uuid() }) },
    responses: { 200: userContractStatsSchema },
  }),
} as const;
