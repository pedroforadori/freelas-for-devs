import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { defineRoute } from '../http/route.js';
import { projectTypeSchema } from './catalog.js';

/**
 * Ciclo do contrato (docs/architecture.md §4.3). A F6 cobre a contratação: pagamento em custódia
 * ou expiração do prazo de pagamento. Entregas e liberação chegam na F7.
 */
export const ContractStatus = {
  AwaitingPayment: 'AWAITING_PAYMENT',
  Funded: 'FUNDED',
  Expired: 'EXPIRED',
  Cancelled: 'CANCELLED',
} as const;
export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];
export const contractStatusSchema = z.enum(
  Object.values(ContractStatus) as [ContractStatus, ...ContractStatus[]],
);

export const CONTRACT_STATUS_LABELS: Readonly<Record<ContractStatus, string>> = {
  AWAITING_PAYMENT: 'Aguardando pagamento',
  FUNDED: 'Pagamento em custódia',
  EXPIRED: 'Prazo de pagamento encerrado',
  CANCELLED: 'Cancelado',
};

export const PaymentStatus = {
  Pending: 'PENDING',
  Succeeded: 'SUCCEEDED',
  Failed: 'FAILED',
  Expired: 'EXPIRED',
  Refunded: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const paymentStatusSchema = z.enum(
  Object.values(PaymentStatus) as [PaymentStatus, ...PaymentStatus[]],
);

/** Valores do contrato, com a comissão já aplicada conforme quem paga (snapshot). */
export const contractAmountsSchema = z
  .object({
    /** Valor da proposta escolhida. */
    proposalCents: z.number().int(),
    platformFeeCents: z.number().int(),
    commissionBps: z.number().int(),
    commissionPayer: z.enum(['CLIENT', 'FREELANCER', 'SPLIT']),
    /** O que o cliente paga (fica em custódia). */
    clientTotalCents: z.number().int(),
    /** O que o freelancer recebe na liberação. */
    freelancerNetCents: z.number().int(),
  })
  .meta({ id: 'ContractAmounts' });

export const contractSchema = z
  .object({
    id: z.uuid(),
    status: contractStatusSchema,
    project: z.object({ id: z.uuid(), title: z.string(), type: projectTypeSchema }),
    client: z.object({ userId: z.uuid(), displayName: z.string() }),
    freelancer: z.object({ userId: z.uuid(), displayName: z.string() }),
    amounts: contractAmountsSchema,
    deadlineDays: z.number().int(),
    paymentDeadlineAt: z.iso.datetime(),
    fundedAt: z.iso.datetime().nullable(),
    /** Há um checkout aberto: o cliente pode voltar a ele em vez de criar outro. */
    paymentInProgress: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Contract' });

export const adminContractSchema = contractSchema
  .extend({
    payments: z.array(
      z.object({
        id: z.uuid(),
        status: paymentStatusSchema,
        amountCents: z.number().int(),
        provider: z.string(),
        providerCheckoutId: z.string(),
        createdAt: z.iso.datetime(),
        succeededAt: z.iso.datetime().nullable(),
        refundedAt: z.iso.datetime().nullable(),
      }),
    ),
    /** Lançamentos contábeis (partidas dobradas) do contrato. */
    ledger: z.array(
      z.object({
        journalId: z.uuid(),
        kind: z.enum(['FUNDING', 'REFUND', 'RELEASE']),
        account: z.string(),
        debitCents: z.number().int(),
        creditCents: z.number().int(),
        createdAt: z.iso.datetime(),
      }),
    ),
    /** Saldo em custódia segundo o razão (créditos − débitos da conta ESCROW). */
    escrowBalanceCents: z.number().int(),
  })
  .meta({ id: 'AdminContract' });

export const payoutAccountSchema = z
  .object({
    /** Conta criada no provedor (onboarding iniciado). */
    exists: z.boolean(),
    detailsSubmitted: z.boolean(),
    /** Pronta para receber repasses. */
    payoutsEnabled: z.boolean(),
  })
  .meta({ id: 'PayoutAccount' });

export type Contract = z.infer<typeof contractSchema>;
export type AdminContract = z.infer<typeof adminContractSchema>;
export type ContractAmounts = z.infer<typeof contractAmountsSchema>;
export type PayoutAccount = z.infer<typeof payoutAccountSchema>;

const contractParams = z.object({ contractId: z.uuid() });
const projectParams = z.object({ projectId: z.uuid() });
const participant = { permission: Permission.ContractsParticipate } as const;

export const contractRoutes = {
  getContract: defineRoute({
    method: 'get',
    path: '/v1/contracts/{contractId}',
    operationId: 'getContract',
    summary: 'Contrato (cliente ou freelancer participante).',
    tags: ['contracts'],
    auth: participant,
    request: { params: contractParams },
    responses: { 200: contractSchema },
  }),
  getProjectContract: defineRoute({
    method: 'get',
    path: '/v1/projects/{projectId}/contract',
    operationId: 'getProjectContract',
    summary: 'Contrato vigente do projeto (o mais recente).',
    tags: ['contracts', 'projects'],
    auth: participant,
    request: { params: projectParams },
    responses: { 200: contractSchema },
  }),
  startCheckout: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/checkout',
    operationId: 'startContractCheckout',
    summary: 'Abre (ou reabre) o checkout do provedor para pagar o contrato em custódia.',
    tags: ['contracts', 'payments'],
    auth: { permission: Permission.ProjectsClientWrite },
    request: { params: contractParams },
    responses: { 200: z.object({ url: z.string() }) },
  }),
  getMyPayoutAccount: defineRoute({
    method: 'get',
    path: '/v1/me/payout-account',
    operationId: 'getMyPayoutAccount',
    summary: 'Situação da conta de recebimento do freelancer.',
    tags: ['payments'],
    auth: { permission: Permission.PayoutsManage },
    request: {},
    responses: { 200: payoutAccountSchema },
  }),
  startPayoutOnboarding: defineRoute({
    method: 'post',
    path: '/v1/me/payout-account/onboarding',
    operationId: 'startPayoutOnboarding',
    summary: 'Link do cadastro de recebimentos no provedor (dados bancários e identidade).',
    tags: ['payments'],
    auth: { permission: Permission.PayoutsManage },
    request: {},
    responses: { 200: z.object({ url: z.string() }) },
  }),
  paymentWebhook: defineRoute({
    method: 'post',
    path: '/v1/webhooks/payments',
    operationId: 'paymentWebhook',
    summary: 'Eventos do provedor de pagamento (assinatura verificada; idempotente).',
    tags: ['payments'],
    auth: 'public',
    request: {},
    responses: { 200: z.object({ received: z.literal(true) }) },
  }),
  devSimulatePayment: defineRoute({
    method: 'post',
    path: '/v1/dev/payments/simulate',
    operationId: 'devSimulatePayment',
    summary: 'Só em desenvolvimento (provedor simulado): conclui ou recusa um checkout.',
    tags: ['dev'],
    auth: { permission: Permission.ProjectsClientWrite },
    request: {
      body: z
        .object({ checkoutId: z.string().max(200), outcome: z.enum(['succeeded', 'failed']) })
        .strict(),
    },
    responses: { 200: z.object({ received: z.literal(true) }) },
  }),
  adminGetProjectContract: defineRoute({
    method: 'get',
    path: '/v1/admin/projects/{projectId}/contract',
    operationId: 'adminGetProjectContract',
    summary: 'Contrato do projeto com pagamentos e lançamentos contábeis.',
    tags: ['admin', 'contracts'],
    auth: { permission: Permission.AdminProjectsRead },
    request: { params: projectParams },
    responses: { 200: adminContractSchema },
  }),
} as const;
