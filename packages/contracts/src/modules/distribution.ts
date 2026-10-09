import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { cursorPage, cursorQuerySchema } from '../common/pagination.js';
import { defineRoute } from '../http/route.js';
import { levelSchema, projectTypeSchema, stackSlugSchema } from './catalog.js';
import { clientScopeSchema } from './projects.js';

/** Ciclo do convite e da proposta (docs/architecture.md §4.2). */
export const InvitationStatus = {
  Invited: 'INVITED',
  Declined: 'DECLINED',
  Expired: 'EXPIRED',
  ProposalSubmitted: 'PROPOSAL_SUBMITTED',
  Withdrawn: 'WITHDRAWN',
  SelectedPendingPayment: 'SELECTED_PENDING_PAYMENT',
  OnHold: 'ON_HOLD',
  Hired: 'HIRED',
  NotSelected: 'NOT_SELECTED',
  Voided: 'VOIDED',
} as const;
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];
export const invitationStatusSchema = z.enum(
  Object.values(InvitationStatus) as [InvitationStatus, ...InvitationStatus[]],
);

export const INVITATION_STATUS_LABELS: Readonly<Record<InvitationStatus, string>> = {
  INVITED: 'Aguardando sua resposta',
  DECLINED: 'Recusado',
  EXPIRED: 'Prazo encerrado',
  PROPOSAL_SUBMITTED: 'Proposta enviada',
  WITHDRAWN: 'Proposta retirada',
  SELECTED_PENDING_PAYMENT: 'Escolhida — aguardando pagamento',
  ON_HOLD: 'Em espera',
  HIRED: 'Contratada',
  NOT_SELECTED: 'Não escolhida',
  VOIDED: 'Encerrado',
};

/** Estados em que o convite ainda ocupa uma vaga da rodada. */
export const ACTIVE_INVITATION_STATUSES: readonly InvitationStatus[] = [
  'INVITED',
  'PROPOSAL_SUBMITTED',
];

export const QueueState = {
  Active: 'ACTIVE',
  Monitoring: 'MONITORING',
  Paused: 'PAUSED',
  Suspended: 'SUSPENDED',
} as const;
export type QueueState = (typeof QueueState)[keyof typeof QueueState];
export const queueStateSchema = z.enum(Object.values(QueueState) as [QueueState, ...QueueState[]]);

export const QueueTier = { Priority: 'PRIORITY', Normal: 'NORMAL' } as const;
export type QueueTier = (typeof QueueTier)[keyof typeof QueueTier];
export const queueTierSchema = z.enum(['PRIORITY', 'NORMAL']);

/** Motivos de não escolha (feedback opcional do cliente, agregado para o freelancer e o Admin). */
export const SelectionFeedbackReason = {
  Price: 'PRICE',
  Portfolio: 'PORTFOLIO',
  GenericProposal: 'GENERIC_PROPOSAL',
  Deadline: 'DEADLINE',
  Other: 'OTHER',
} as const;
export type SelectionFeedbackReason =
  (typeof SelectionFeedbackReason)[keyof typeof SelectionFeedbackReason];
export const selectionFeedbackReasonSchema = z.enum(
  Object.values(SelectionFeedbackReason) as [SelectionFeedbackReason, ...SelectionFeedbackReason[]],
);
export const SELECTION_FEEDBACK_LABELS: Readonly<Record<SelectionFeedbackReason, string>> = {
  PRICE: 'Preço',
  PORTFOLIO: 'Portfólio',
  GENERIC_PROPOSAL: 'Proposta genérica',
  DEADLINE: 'Prazo',
  OTHER: 'Outro motivo',
};

export const PROPOSAL_LIMITS = { messageMin: 80, messageMax: 3000 } as const;

export const proposalInputSchema = z
  .object({
    amountCents: z.number('Informe o valor.').int().positive('Informe o valor.'),
    deadlineDays: z
      .number('Informe o prazo em dias.')
      .int('Use um número inteiro de dias.')
      .min(1, 'Informe o prazo em dias.'),
    message: z
      .string()
      .trim()
      .min(
        PROPOSAL_LIMITS.messageMin,
        `Explique em ao menos ${PROPOSAL_LIMITS.messageMin} caracteres como você vai fazer o projeto.`,
      )
      .max(PROPOSAL_LIMITS.messageMax),
  })
  .strict()
  .meta({ id: 'ProposalInput' });

export const proposalSchema = proposalInputSchema
  .extend({ submittedAt: z.iso.datetime(), updatedAt: z.iso.datetime() })
  .meta({ id: 'Proposal' });

const invitationProjectSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  type: projectTypeSchema,
  description: z.string(),
  scope: clientScopeSchema,
});

/** Convite visto pelo freelancer: o projeto com o escopo aprovado e a própria proposta. */
export const invitationSchema = z
  .object({
    id: z.uuid(),
    status: invitationStatusSchema,
    invitedAt: z.iso.datetime(),
    /** Prazo para responder enquanto o convite está aberto. */
    deadlineAt: z.iso.datetime(),
    project: invitationProjectSchema,
    proposal: proposalSchema.nullable(),
  })
  .meta({ id: 'Invitation' });

export const invitationSummarySchema = invitationSchema
  .omit({ project: true, proposal: true })
  .extend({
    project: invitationProjectSchema.pick({ id: true, title: true, type: true }).extend({
      priceRange: clientScopeSchema.shape.priceRange,
      deadlineDays: z.number().int(),
    }),
    hasProposal: z.boolean(),
  })
  .meta({ id: 'InvitationSummary' });

/** Posição do freelancer na fila (transparência: docs/architecture.md §10, risco 7). */
export const myQueueStatusSchema = z
  .object({
    inQueue: z.boolean(),
    level: levelSchema.nullable(),
    state: queueStateSchema.nullable(),
    tier: queueTierSchema.nullable(),
    /** 1 = o próximo a ser convidado no nível (entre os elegíveis em geral). */
    position: z.number().int().nullable(),
    totalInLevel: z.number().int(),
    openInvitations: z.number().int(),
  })
  .meta({ id: 'MyQueueStatus' });

export const proposalForClientSchema = z
  .object({
    invitationId: z.uuid(),
    status: invitationStatusSchema,
    freelancer: z.object({
      userId: z.uuid(),
      displayName: z.string(),
      headline: z.string(),
      level: levelSchema.nullable(),
      stacks: z.array(stackSlugSchema),
      portfolioItems: z.number().int(),
    }),
    amountCents: z.number().int(),
    deadlineDays: z.number().int(),
    message: z.string(),
    submittedAt: z.iso.datetime(),
  })
  .meta({ id: 'ProposalForClient' });

export const projectProposalsSchema = z
  .object({
    /** Convites ainda sem resposta (o cliente vê quantos, não quem). */
    awaitingResponses: z.number().int(),
    proposals: z.array(proposalForClientSchema),
  })
  .meta({ id: 'ProjectProposals' });

export const selectProposalRequestSchema = z
  .object({
    invitationId: z.uuid(),
    /** Opcional: por que as outras propostas não foram escolhidas. */
    feedback: z
      .array(
        z
          .object({
            invitationId: z.uuid(),
            reasons: z.array(selectionFeedbackReasonSchema).min(1).max(5),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict()
  .meta({ id: 'SelectProposalRequest' });

export const adminQueueEntrySchema = z
  .object({
    position: z.number().int().nullable(),
    userId: z.uuid(),
    displayName: z.string(),
    levelSlug: z.string(),
    state: queueStateSchema,
    tier: queueTierSchema,
    prioritySince: z.iso.datetime().nullable(),
    lastInvitedAt: z.iso.datetime().nullable(),
    roundsWithoutSelection: z.number().int(),
    openInvitations: z.number().int(),
    declines: z.number().int(),
    noResponses: z.number().int(),
    selections: z.number().int(),
    /** Perfil disponível e aprovado (fora disso não recebe convites). */
    available: z.boolean(),
  })
  .meta({ id: 'AdminQueueEntry' });

export const adminDistributionSchema = z
  .object({
    round: z
      .object({
        id: z.uuid(),
        status: z.enum(['OPEN', 'SELECTED', 'EXHAUSTED', 'CLOSED', 'CANCELLED']),
        levelSlug: z.string(),
        roundSize: z.number().int(),
        maxInvites: z.number().int(),
        inviteResponseHours: z.number().int(),
        openedAt: z.iso.datetime(),
      })
      .nullable(),
    invitations: z.array(
      z.object({
        id: z.uuid(),
        freelancer: z.object({ userId: z.uuid(), displayName: z.string() }),
        status: invitationStatusSchema,
        invitedAt: z.iso.datetime(),
        deadlineAt: z.iso.datetime(),
        amountCents: z.number().int().nullable(),
        deadlineDays: z.number().int().nullable(),
        feedback: z.array(selectionFeedbackReasonSchema).nullable(),
      }),
    ),
  })
  .meta({ id: 'AdminDistribution' });

export type Invitation = z.infer<typeof invitationSchema>;
export type InvitationSummary = z.infer<typeof invitationSummarySchema>;
export type ProposalInput = z.infer<typeof proposalInputSchema>;
export type MyQueueStatus = z.infer<typeof myQueueStatusSchema>;
export type ProposalForClient = z.infer<typeof proposalForClientSchema>;
export type ProjectProposals = z.infer<typeof projectProposalsSchema>;
export type SelectProposalRequest = z.infer<typeof selectProposalRequestSchema>;
export type AdminQueueEntry = z.infer<typeof adminQueueEntrySchema>;
export type AdminDistribution = z.infer<typeof adminDistributionSchema>;

const invitationParams = z.object({ invitationId: z.uuid() });
const projectParams = z.object({ projectId: z.uuid() });
const freelancer = { permission: Permission.ProposalsFreelancerWrite } as const;
const client = { permission: Permission.ProjectsClientWrite } as const;

export const distributionRoutes = {
  listMyInvitations: defineRoute({
    method: 'get',
    path: '/v1/me/invitations',
    operationId: 'listMyInvitations',
    summary: 'Convites do freelancer: abertos (a responder) ou histórico.',
    tags: ['distribution'],
    auth: freelancer,
    request: {
      query: cursorQuerySchema.extend({ view: z.enum(['open', 'history']).default('open') }),
    },
    responses: { 200: cursorPage(invitationSummarySchema) },
  }),
  getInvitation: defineRoute({
    method: 'get',
    path: '/v1/invitations/{invitationId}',
    operationId: 'getInvitation',
    summary: 'Convite com o escopo aprovado do projeto e a proposta enviada.',
    tags: ['distribution'],
    auth: freelancer,
    request: { params: invitationParams },
    responses: { 200: invitationSchema },
  }),
  declineInvitation: defineRoute({
    method: 'post',
    path: '/v1/invitations/{invitationId}/decline',
    operationId: 'declineInvitation',
    summary: 'Recusa o convite (perde a vez na fila; a vaga vai para o próximo).',
    tags: ['distribution'],
    auth: freelancer,
    request: { params: invitationParams },
    responses: { 200: invitationSchema },
  }),
  submitProposal: defineRoute({
    method: 'put',
    path: '/v1/invitations/{invitationId}/proposal',
    operationId: 'submitProposal',
    summary: 'Envia ou edita a proposta (valor dentro da faixa e prazo dentro do escopo).',
    tags: ['distribution'],
    auth: freelancer,
    request: { params: invitationParams, body: proposalInputSchema },
    responses: { 200: invitationSchema },
  }),
  withdrawProposal: defineRoute({
    method: 'post',
    path: '/v1/invitations/{invitationId}/withdraw',
    operationId: 'withdrawProposal',
    summary: 'Retira a proposta antes da escolha (equivale a recusar).',
    tags: ['distribution'],
    auth: freelancer,
    request: { params: invitationParams },
    responses: { 200: invitationSchema },
  }),
  getMyQueueStatus: defineRoute({
    method: 'get',
    path: '/v1/me/queue',
    operationId: 'getMyQueueStatus',
    summary: 'Situação e posição do freelancer na fila do seu nível.',
    tags: ['distribution'],
    auth: freelancer,
    request: {},
    responses: { 200: myQueueStatusSchema },
  }),
  listProjectProposals: defineRoute({
    method: 'get',
    path: '/v1/projects/{projectId}/proposals',
    operationId: 'listProjectProposals',
    summary: 'Propostas recebidas pelo projeto do cliente.',
    tags: ['distribution', 'projects'],
    auth: client,
    request: { params: projectParams },
    responses: { 200: projectProposalsSchema },
  }),
  selectProposal: defineRoute({
    method: 'post',
    path: '/v1/projects/{projectId}/selection',
    operationId: 'selectProposal',
    summary: 'Escolhe uma proposta (com feedback opcional sobre as demais).',
    tags: ['distribution', 'projects'],
    auth: client,
    request: { params: projectParams, body: selectProposalRequestSchema },
    responses: { 200: projectProposalsSchema },
  }),
  adminListQueue: defineRoute({
    method: 'get',
    path: '/v1/admin/queue',
    operationId: 'adminListQueue',
    summary: 'Fila de um nível na ordem de convite, ou freelancers em acompanhamento.',
    tags: ['admin', 'distribution'],
    auth: { permission: Permission.AdminQueueManage },
    request: {
      query: z.object({
        levelSlug: z.string().max(40).optional(),
        state: queueStateSchema.default('ACTIVE'),
      }),
    },
    responses: { 200: z.object({ items: z.array(adminQueueEntrySchema) }) },
  }),
  adminReactivateFreelancer: defineRoute({
    method: 'post',
    path: '/v1/admin/queue/{userId}/reactivate',
    operationId: 'adminReactivateFreelancer',
    summary: 'Encerra o acompanhamento: volta à fila com prioridade.',
    tags: ['admin', 'distribution'],
    auth: { permission: Permission.AdminQueueManage },
    request: { params: z.object({ userId: z.uuid() }) },
    responses: { 200: adminQueueEntrySchema },
  }),
  adminProjectDistribution: defineRoute({
    method: 'get',
    path: '/v1/admin/projects/{projectId}/distribution',
    operationId: 'adminProjectDistribution',
    summary: 'Rodada atual do projeto e todos os convites, com status e propostas.',
    tags: ['admin', 'distribution'],
    auth: { permission: Permission.AdminProjectsRead },
    request: { params: projectParams },
    responses: { 200: adminDistributionSchema },
  }),
} as const;
