import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { defineRoute } from '../http/route.js';
import { projectTypeSchema } from './catalog.js';

/**
 * Ciclo do contrato (docs/architecture.md §4.3): pagamento em custódia (F6), entregas em rodadas
 * e liberação do pagamento ao freelancer (F7). Disputas e fora de escopo chegam na F8.
 */
export const ContractStatus = {
  AwaitingPayment: 'AWAITING_PAYMENT',
  Active: 'ACTIVE',
  Approved: 'APPROVED',
  Released: 'RELEASED',
  Expired: 'EXPIRED',
  Cancelled: 'CANCELLED',
} as const;
export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];
export const contractStatusSchema = z.enum(
  Object.values(ContractStatus) as [ContractStatus, ...ContractStatus[]],
);

export const CONTRACT_STATUS_LABELS: Readonly<Record<ContractStatus, string>> = {
  AWAITING_PAYMENT: 'Aguardando pagamento',
  ACTIVE: 'Em andamento',
  APPROVED: 'Aprovado — liberando pagamento',
  RELEASED: 'Concluído e pago',
  EXPIRED: 'Prazo de pagamento encerrado',
  CANCELLED: 'Cancelado',
};

/** Etapa das entregas enquanto o contrato está ativo (1ª entrega, 2ª entrega e final). */
export const DeliveryStage = {
  WorkingD1: 'WORKING_D1',
  ReviewD1: 'REVIEW_D1',
  WorkingD2: 'WORKING_D2',
  ReviewD2: 'REVIEW_D2',
  WorkingFinal: 'WORKING_FINAL',
  FinalReview: 'FINAL_REVIEW',
} as const;
export type DeliveryStage = (typeof DeliveryStage)[keyof typeof DeliveryStage];
export const deliveryStageSchema = z.enum(
  Object.values(DeliveryStage) as [DeliveryStage, ...DeliveryStage[]],
);

export const DELIVERY_STAGE_LABELS: Readonly<Record<DeliveryStage, string>> = {
  WORKING_D1: 'Trabalhando na 1ª entrega',
  REVIEW_D1: 'Cliente revisando a 1ª entrega',
  WORKING_D2: 'Trabalhando na 2ª entrega',
  REVIEW_D2: 'Cliente revisando a 2ª entrega',
  WORKING_FINAL: 'Trabalhando na entrega final',
  FINAL_REVIEW: 'Cliente revisando a entrega final',
};

export const DELIVERY_LIMITS = {
  messageMin: 20,
  messageMax: 4000,
  linksMax: 10,
  attachmentsMax: 10,
  adjustmentsMax: 30,
  adjustmentMax: 500,
} as const;

export const deliveryInputSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(DELIVERY_LIMITS.messageMin, 'Descreva o que foi entregue e como testar.')
      .max(DELIVERY_LIMITS.messageMax),
    links: z
      .array(z.url({ protocol: /^https$/, error: 'Use links https://' }).max(500))
      .max(DELIVERY_LIMITS.linksMax)
      .default([]),
    attachmentIds: z.array(z.uuid()).max(DELIVERY_LIMITS.attachmentsMax).default([]),
  })
  .strict()
  .meta({ id: 'DeliveryInput' });

const adjustmentText = z.string().trim().min(3).max(DELIVERY_LIMITS.adjustmentMax);

/** Revisão do cliente: aprovar, pedir a lista (única) de ajustes ou, na final, uma correção pontual. */
export const deliveryReviewSchema = z
  .discriminatedUnion('decision', [
    z.object({ decision: z.literal('APPROVE') }).strict(),
    z
      .object({
        decision: z.literal('ADJUSTMENTS'),
        items: z
          .array(adjustmentText)
          .min(1, 'Liste ao menos um ajuste.')
          .max(DELIVERY_LIMITS.adjustmentsMax),
      })
      .strict(),
    z
      .object({
        decision: z.literal('CORRECTION'),
        /** Só itens de ajuste já pedidos; pedido novo é fora de escopo (F8). */
        adjustmentIds: z.array(z.uuid()).min(1).max(DELIVERY_LIMITS.adjustmentsMax),
        note: z.string().trim().max(DELIVERY_LIMITS.adjustmentMax).optional(),
      })
      .strict(),
  ])
  .meta({ id: 'DeliveryReview' });

export const ratingInputSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict()
  .meta({ id: 'RatingInput' });

export const deliverySchema = z
  .object({
    number: z.number().int().min(1).max(3),
    submittedAt: z.iso.datetime(),
    message: z.string(),
    links: z.array(z.string()),
    attachments: z.array(
      z.object({
        id: z.uuid(),
        fileName: z.string(),
        size: z.number().int(),
        status: z.string(),
      }),
    ),
    reviewDeadlineAt: z.iso.datetime(),
    reviewedAt: z.iso.datetime().nullable(),
    outcome: z
      .enum(['ADJUSTMENTS', 'APPROVED', 'TIMEOUT', 'CORRECTION', 'AUTO_APPROVED'])
      .nullable(),
    adjustments: z.array(z.object({ id: z.uuid(), text: z.string() })),
    correction: z
      .object({ adjustmentIds: z.array(z.uuid()), note: z.string().nullable() })
      .nullable(),
  })
  .meta({ id: 'Delivery' });

export const contractWorkSchema = z
  .object({
    stage: deliveryStageSchema.nullable(),
    /** Prazo combinado na proposta, contado do pagamento. */
    dueAt: z.iso.datetime(),
    /** Quando o cliente precisa revisar a entrega atual (sem resposta, ela avança sozinha). */
    reviewDeadlineAt: z.iso.datetime().nullable(),
    correctionsLeft: z.number().int(),
    deliveries: z.array(deliverySchema),
    approvedAt: z.iso.datetime().nullable(),
    approvedAutomatically: z.boolean(),
    releasedAt: z.iso.datetime().nullable(),
    rating: z
      .object({
        rating: z.number().int(),
        comment: z.string().nullable(),
        createdAt: z.iso.datetime(),
      })
      .nullable(),
  })
  .meta({ id: 'ContractWork' });

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
    /** Entregas e aprovação (a partir do pagamento). */
    work: contractWorkSchema.nullable(),
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
        kind: z.enum(['FUNDING', 'REFUND', 'RELEASE', 'PAYOUT']),
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

export const contractSummarySchema = z
  .object({
    id: z.uuid(),
    status: contractStatusSchema,
    stage: deliveryStageSchema.nullable(),
    project: z.object({ id: z.uuid(), title: z.string() }),
    counterpart: z.object({ userId: z.uuid(), displayName: z.string() }),
    role: z.enum(['CLIENT', 'FREELANCER']),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'ContractSummary' });

export type Contract = z.infer<typeof contractSchema>;
export type ContractSummary = z.infer<typeof contractSummarySchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type DeliveryInput = z.infer<typeof deliveryInputSchema>;
export type DeliveryReview = z.infer<typeof deliveryReviewSchema>;
export type RatingInput = z.infer<typeof ratingInputSchema>;
export type AdminContract = z.infer<typeof adminContractSchema>;
export type ContractAmounts = z.infer<typeof contractAmountsSchema>;
export type PayoutAccount = z.infer<typeof payoutAccountSchema>;

const contractParams = z.object({ contractId: z.uuid() });
const projectParams = z.object({ projectId: z.uuid() });
const participant = { permission: Permission.ContractsParticipate } as const;

export const contractRoutes = {
  listMyContracts: defineRoute({
    method: 'get',
    path: '/v1/me/contracts',
    operationId: 'listMyContracts',
    summary: 'Contratos do usuário (como cliente ou freelancer), mais recentes primeiro.',
    tags: ['contracts'],
    auth: participant,
    request: {},
    responses: { 200: z.object({ items: z.array(contractSummarySchema) }) },
  }),
  submitDelivery: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/deliveries',
    operationId: 'submitDelivery',
    summary: 'Freelancer envia a entrega da etapa atual (1ª, 2ª ou final).',
    tags: ['contracts'],
    auth: { permission: Permission.ProposalsFreelancerWrite },
    request: { params: contractParams, body: deliveryInputSchema },
    responses: { 201: contractSchema },
  }),
  reviewDelivery: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/review',
    operationId: 'reviewDelivery',
    summary: 'Cliente aprova, pede ajustes (lista única) ou, na final, uma correção pontual.',
    tags: ['contracts'],
    auth: { permission: Permission.ProjectsClientWrite },
    request: { params: contractParams, body: deliveryReviewSchema },
    responses: { 200: contractSchema },
  }),
  rateFreelancer: defineRoute({
    method: 'post',
    path: '/v1/contracts/{contractId}/rating',
    operationId: 'rateFreelancer',
    summary: 'Cliente avalia o trabalho depois da aprovação (uma vez).',
    tags: ['contracts'],
    auth: { permission: Permission.ProjectsClientWrite },
    request: { params: contractParams, body: ratingInputSchema },
    responses: { 200: contractSchema },
  }),
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
