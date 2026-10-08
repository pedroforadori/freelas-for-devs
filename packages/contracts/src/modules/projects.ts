import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { cursorPage, cursorQuerySchema } from '../common/pagination.js';
import { defineRoute } from '../http/route.js';
import { projectTypeSchema, stackSlugSchema } from './catalog.js';
import { fileSchema } from './files.js';

/**
 * Ciclo do projeto (docs/architecture.md §4.1). A F2 cobre da publicação até o escopo com o
 * especialista; os estados de fila, contratação e execução chegam nas fases seguintes.
 */
export const ProjectStatus = {
  Estimating: 'ESTIMATING',
  AwaitingClarification: 'AWAITING_CLARIFICATION',
  Scoping: 'SCOPING',
  Cancelled: 'CANCELLED',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];
export const projectStatusSchema = z.enum(
  Object.values(ProjectStatus) as [ProjectStatus, ...ProjectStatus[]],
);

export const PROJECT_STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  ESTIMATING: 'Gerando estimativa',
  AWAITING_CLARIFICATION: 'Aguardando suas respostas',
  SCOPING: 'Escopo com especialista',
  CANCELLED: 'Cancelado',
};

export const DesiredDeadline = {
  Flexible: 'FLEXIBLE',
  UpTo1Month: 'UP_TO_1_MONTH',
  UpTo3Months: 'UP_TO_3_MONTHS',
  MoreThan3Months: 'MORE_THAN_3_MONTHS',
} as const;
export type DesiredDeadline = (typeof DesiredDeadline)[keyof typeof DesiredDeadline];
export const desiredDeadlineSchema = z.enum(
  Object.values(DesiredDeadline) as [DesiredDeadline, ...DesiredDeadline[]],
);

export const DESIRED_DEADLINE_LABELS: Readonly<Record<DesiredDeadline, string>> = {
  FLEXIBLE: 'Sem pressa',
  UP_TO_1_MONTH: 'Até 1 mês',
  UP_TO_3_MONTHS: 'Até 3 meses',
  MORE_THAN_3_MONTHS: 'Mais de 3 meses',
};

export const PROJECT_LIMITS = {
  titleMin: 5,
  titleMax: 100,
  descriptionMin: 80,
  descriptionMax: 5000,
  referencesMax: 5,
  attachmentsMax: 5,
  /** Publicações por cliente a cada 24 h (cada uma consome uma estimativa de IA). */
  perDay: 3,
  /** Projetos ainda não concluídos/cancelados por cliente. */
  openMax: 5,
  otherAnswerMax: 300,
} as const;

const referenceUrl = z
  .url({ protocol: /^https?$/, error: 'Informe um link começando com https://' })
  .max(500);

/** Rascunho publicado pelo cliente. O mesmo schema valida o formulário do web e a API. */
export const createProjectRequestSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(PROJECT_LIMITS.titleMin, 'Dê um título com ao menos 5 caracteres.')
      .max(PROJECT_LIMITS.titleMax),
    type: projectTypeSchema,
    description: z
      .string()
      .trim()
      .min(
        PROJECT_LIMITS.descriptionMin,
        `Descreva com ao menos ${PROJECT_LIMITS.descriptionMin} caracteres: o que é, para quem e o que precisa fazer.`,
      )
      .max(PROJECT_LIMITS.descriptionMax),
    references: z.array(referenceUrl).max(PROJECT_LIMITS.referencesMax).default([]),
    desiredDeadline: desiredDeadlineSchema.optional(),
    attachmentIds: z.array(z.uuid()).max(PROJECT_LIMITS.attachmentsMax).default([]),
  })
  .strict()
  .meta({ id: 'CreateProjectRequest' });

export const clarificationQuestionSchema = z
  .object({
    id: z.string(),
    question: z.string(),
    options: z
      .array(z.object({ id: z.string(), label: z.string() }))
      .min(2)
      .max(5),
    /** Permite resposta livre ("Outro: ...") além das opções. */
    allowOther: z.boolean(),
  })
  .meta({ id: 'ClarificationQuestion' });

export const clarificationAnswerSchema = z
  .object({
    questionId: z.string().max(20),
    optionId: z.string().max(20).optional(),
    other: z.string().trim().min(1).max(PROJECT_LIMITS.otherAnswerMax).optional(),
  })
  .strict()
  .refine((answer) => Boolean(answer.optionId) !== Boolean(answer.other), {
    error: 'Escolha uma opção ou escreva sua resposta.',
  })
  .meta({ id: 'ClarificationAnswer' });

export const answerClarificationsRequestSchema = z
  .object({ answers: z.array(clarificationAnswerSchema).min(1).max(5) })
  .strict()
  .meta({ id: 'AnswerClarificationsRequest' });

const brlRange = z
  .object({ minCents: z.number().int().nonnegative(), maxCents: z.number().int().nonnegative() })
  .meta({ id: 'PriceRange' });

/** Estimativa vista pelo cliente: preliminar, revisada por um especialista antes da fila. */
export const clientEstimateSchema = z
  .object({
    summary: z.string(),
    priceRange: brlRange,
    durationDays: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
    features: z.array(z.string()),
    assumptions: z.array(z.string()),
  })
  .meta({ id: 'ClientEstimate' });

export const Complexity = { Low: 'LOW', Medium: 'MEDIUM', High: 'HIGH' } as const;
export type Complexity = (typeof Complexity)[keyof typeof Complexity];
export const complexitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

/** Estimativa completa (Admin): inclui a sugestão de nível, stacks e alertas para o escopo. */
export const estimateSchema = clientEstimateSchema
  .extend({
    suggestedType: projectTypeSchema,
    complexity: complexitySchema,
    suggestedLevel: z.string(),
    suggestedStacks: z.array(stackSlugSchema),
    risks: z.array(z.string()),
    /** Observações só para o Admin (ex.: pedido fora do foco, descrição contraditória). */
    reviewNotes: z.array(z.string()),
  })
  .meta({ id: 'Estimate' });

const attachmentSchema = fileSchema
  .pick({ id: true, fileName: true, contentType: true, size: true, status: true })
  .meta({ id: 'ProjectAttachment' });

export const projectSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    type: projectTypeSchema,
    description: z.string(),
    references: z.array(z.string()),
    desiredDeadline: desiredDeadlineSchema.nullable(),
    attachments: z.array(attachmentSchema),
    status: projectStatusSchema,
    clarification: z
      .object({
        questions: z.array(clarificationQuestionSchema),
        answers: z.array(clarificationAnswerSchema).nullable(),
      })
      .nullable(),
    estimate: clientEstimateSchema.nullable(),
    /** A IA não conseguiu estimar: o especialista fará a estimativa no escopo. */
    estimateUnavailable: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Project' });

export const projectSummarySchema = projectSchema
  .pick({ id: true, title: true, type: true, status: true, createdAt: true, updatedAt: true })
  .meta({ id: 'ProjectSummary' });

export const adminProjectSummarySchema = projectSummarySchema
  .extend({ client: z.object({ userId: z.uuid(), displayName: z.string(), email: z.string() }) })
  .meta({ id: 'AdminProjectSummary' });

export const adminProjectDetailSchema = projectSchema
  .omit({ estimate: true })
  .extend({
    client: adminProjectSummarySchema.shape.client,
    estimate: estimateSchema.nullable(),
    /** Chamadas à IA (custo e auditoria do prompt). */
    aiRuns: z.array(
      z.object({
        round: z.number().int(),
        outcome: z.enum(['ESTIMATE', 'CLARIFY', 'ERROR']),
        model: z.string(),
        promptVersion: z.string(),
        inputTokens: z.number().int(),
        outputTokens: z.number().int(),
        durationMs: z.number().int(),
        createdAt: z.iso.datetime(),
      }),
    ),
  })
  .meta({ id: 'AdminProjectDetail' });

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type ClarificationQuestion = z.infer<typeof clarificationQuestionSchema>;
export type ClarificationAnswer = z.infer<typeof clarificationAnswerSchema>;
export type ClientEstimate = z.infer<typeof clientEstimateSchema>;
export type Estimate = z.infer<typeof estimateSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type AdminProjectSummary = z.infer<typeof adminProjectSummarySchema>;
export type AdminProjectDetail = z.infer<typeof adminProjectDetailSchema>;

const projectParams = z.object({ projectId: z.uuid() });
const clientWrite = { permission: Permission.ProjectsClientWrite } as const;
const adminRead = { permission: Permission.AdminProjectsRead } as const;

export const projectRoutes = {
  createProject: defineRoute({
    method: 'post',
    path: '/v1/projects',
    operationId: 'createProject',
    summary: 'Publica o projeto; a estimativa de IA é gerada em segundo plano.',
    tags: ['projects'],
    auth: clientWrite,
    request: { body: createProjectRequestSchema },
    responses: { 201: projectSchema },
  }),
  listMyProjects: defineRoute({
    method: 'get',
    path: '/v1/projects',
    operationId: 'listMyProjects',
    summary: 'Projetos do cliente, mais recentes primeiro.',
    tags: ['projects'],
    auth: clientWrite,
    request: { query: cursorQuerySchema },
    responses: { 200: cursorPage(projectSummarySchema) },
  }),
  getProject: defineRoute({
    method: 'get',
    path: '/v1/projects/{projectId}',
    operationId: 'getProject',
    summary: 'Projeto do cliente com perguntas e estimativa.',
    tags: ['projects'],
    auth: clientWrite,
    request: { params: projectParams },
    responses: { 200: projectSchema },
  }),
  answerClarifications: defineRoute({
    method: 'post',
    path: '/v1/projects/{projectId}/clarifications',
    operationId: 'answerProjectClarifications',
    summary: 'Responde às perguntas da IA; a estimativa é refeita com as respostas.',
    tags: ['projects'],
    auth: clientWrite,
    request: { params: projectParams, body: answerClarificationsRequestSchema },
    responses: { 200: projectSchema },
  }),
  cancelProject: defineRoute({
    method: 'post',
    path: '/v1/projects/{projectId}/cancel',
    operationId: 'cancelProject',
    summary: 'Cancela o projeto (sem custo antes da contratação).',
    tags: ['projects'],
    auth: clientWrite,
    request: {
      params: projectParams,
      body: z.object({ reason: z.string().trim().max(500).optional() }).strict(),
    },
    responses: { 200: projectSchema },
  }),
  adminListProjects: defineRoute({
    method: 'get',
    path: '/v1/admin/projects',
    operationId: 'adminListProjects',
    summary: 'Projetos por status (mais antigos primeiro: ordem de atendimento).',
    tags: ['admin', 'projects'],
    auth: adminRead,
    request: {
      query: cursorQuerySchema.extend({ status: projectStatusSchema.default('SCOPING') }),
    },
    responses: { 200: cursorPage(adminProjectSummarySchema) },
  }),
  adminGetProject: defineRoute({
    method: 'get',
    path: '/v1/admin/projects/{projectId}',
    operationId: 'adminGetProject',
    summary: 'Projeto completo com a estimativa detalhada e o histórico de chamadas à IA.',
    tags: ['admin', 'projects'],
    auth: adminRead,
    request: { params: projectParams },
    responses: { 200: adminProjectDetailSchema },
  }),
} as const;
