import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { cursorPage, cursorQuerySchema } from '../common/pagination.js';
import { defineRoute } from '../http/route.js';
import { projectTypeSchema, stackSlugSchema } from './catalog.js';
import { fileSchema } from './files.js';

/**
 * Ciclo do projeto (docs/architecture.md §4.1). A F2 cobre da publicação até o escopo com o
 * especialista (F2), o escopo (F4), a distribuição (F5) e a contratação com pagamento (F6).
 */
export const ProjectStatus = {
  Estimating: 'ESTIMATING',
  AwaitingClarification: 'AWAITING_CLARIFICATION',
  Scoping: 'SCOPING',
  ReadyForQueue: 'READY_FOR_QUEUE',
  Distributing: 'DISTRIBUTING',
  NoCandidates: 'NO_CANDIDATES',
  Hiring: 'HIRING',
  InProgress: 'IN_PROGRESS',
  ClosedByDispute: 'CLOSED_BY_DISPUTE',
  Completed: 'COMPLETED',
  Rejected: 'REJECTED',
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
  READY_FOR_QUEUE: 'Escopo aprovado',
  DISTRIBUTING: 'Recebendo propostas',
  NO_CANDIDATES: 'Sem devs disponíveis',
  HIRING: 'Proposta escolhida',
  IN_PROGRESS: 'Em andamento',
  CLOSED_BY_DISPUTE: 'Encerrado pela mediação',
  COMPLETED: 'Concluído',
  REJECTED: 'Recusado',
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

const scopeItem = z
  .string()
  .trim()
  .min(2, 'Cada item precisa de ao menos 2 caracteres.')
  .max(300, 'Cada item pode ter até 300 caracteres.');

/**
 * Escopo padronizado fechado pelo especialista (versionado). É a referência de tudo o que vem
 * depois: proposta dentro da faixa, entregas, critérios de aceite e o que é "fora de escopo".
 */
export const scopeInputSchema = z
  .object({
    type: projectTypeSchema,
    objective: z
      .string()
      .trim()
      .min(20, 'Descreva o objetivo com ao menos 20 caracteres.')
      .max(2000),
    features: z
      .array(scopeItem)
      .min(1, 'Liste ao menos uma funcionalidade.')
      .max(30, 'Até 30 funcionalidades.'),
    screens: z.array(scopeItem).max(40, 'Até 40 telas.').default([]),
    acceptanceCriteria: z
      .array(scopeItem)
      .min(1, 'Liste ao menos um critério de aceite.')
      .max(30, 'Até 30 critérios.'),
    requiredStacks: z.array(stackSlugSchema).max(8, 'Até 8 stacks.').default([]),
    levelSlug: z.string().min(1, 'Escolha o nível.').max(40),
    priceRange: z
      .object({
        minCents: z.number('Informe o valor.').int().positive('Informe um valor maior que zero.'),
        maxCents: z.number('Informe o valor.').int().positive('Informe um valor maior que zero.'),
      })
      .refine((range) => range.minCents <= range.maxCents, {
        error: 'O mínimo não pode ser maior que o máximo.',
        path: ['maxCents'],
      }),
    deadlineDays: z
      .number('Informe o prazo em dias.')
      .int('Use um número inteiro de dias.')
      .min(1, 'Informe o prazo em dias.')
      .max(730, 'Prazo máximo de 730 dias.'),
    notesForFreelancers: z.string().trim().max(2000).optional(),
  })
  .strict()
  .meta({ id: 'ScopeInput' });

export const scopeSchema = scopeInputSchema
  .extend({ notesForFreelancers: z.string().nullable() })
  .meta({ id: 'Scope' });

/** Escopo visto pelo cliente depois da aprovação (o nível do freelancer é interno). */
export const clientScopeSchema = scopeSchema.omit({ levelSlug: true }).meta({ id: 'ClientScope' });

export const scopeVersionSchema = z
  .object({
    version: z.number().int().positive(),
    scope: scopeSchema,
    createdBy: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ScopeVersion' });

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
    /** Escopo aprovado (só a partir de READY_FOR_QUEUE). */
    scope: clientScopeSchema.nullable(),
    rejectionReason: z.string().nullable(),
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
  .omit({ estimate: true, scope: true })
  .extend({
    client: adminProjectSummarySchema.shape.client,
    estimate: estimateSchema.nullable(),
    /** Versão atual do escopo (rascunho do especialista ou a aprovada). */
    scope: scopeSchema.nullable(),
    scopeVersions: z.array(scopeVersionSchema),
    scopingStartedAt: z.iso.datetime().nullable(),
    scopeApprovedAt: z.iso.datetime().nullable(),
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

export const scopingMetricsSchema = z
  .object({
    queue: z.object({
      scoping: z.number().int(),
      /** Há quanto tempo o projeto mais antigo espera o escopo. */
      oldestWaitingHours: z.number().nullable(),
    }),
    last30Days: z.object({
      approved: z.number().int(),
      rejected: z.number().int(),
      medianHoursToApprove: z.number().nullable(),
      p90HoursToApprove: z.number().nullable(),
      avgVersionsPerApproval: z.number().nullable(),
      /**
       * Faixa aprovada vs. estimativa da IA (pontos médios): mediana do desvio relativo.
       * Positivo = o especialista aprovou acima da IA. Base para calibrar o prompt.
       */
      estimateDeviation: z.object({
        samples: z.number().int(),
        medianPct: z.number().nullable(),
      }),
    }),
  })
  .meta({ id: 'ScopingMetrics' });

export type ScopeInput = z.input<typeof scopeInputSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type ClientScope = z.infer<typeof clientScopeSchema>;
export type ScopeVersion = z.infer<typeof scopeVersionSchema>;
export type ScopingMetrics = z.infer<typeof scopingMetricsSchema>;
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
const adminScope = { permission: Permission.AdminProjectsScope } as const;

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
  adminSaveScope: defineRoute({
    method: 'put',
    path: '/v1/admin/projects/{projectId}/scope',
    operationId: 'adminSaveProjectScope',
    summary: 'Salva uma nova versão do escopo (rascunho do especialista).',
    tags: ['admin', 'projects'],
    auth: adminScope,
    request: { params: projectParams, body: scopeInputSchema },
    responses: { 200: adminProjectDetailSchema },
  }),
  adminApproveScope: defineRoute({
    method: 'post',
    path: '/v1/admin/projects/{projectId}/approve',
    operationId: 'adminApproveProjectScope',
    summary: 'Aprova a versão informada do escopo: o projeto fica pronto para a fila.',
    tags: ['admin', 'projects'],
    auth: adminScope,
    request: {
      params: projectParams,
      body: z.object({ version: z.number().int().positive() }).strict(),
    },
    responses: { 200: adminProjectDetailSchema },
  }),
  adminRejectProject: defineRoute({
    method: 'post',
    path: '/v1/admin/projects/{projectId}/reject',
    operationId: 'adminRejectProject',
    summary: 'Recusa o projeto (fora do foco, ilegal, inviável), com motivo enviado ao cliente.',
    tags: ['admin', 'projects'],
    auth: adminScope,
    request: {
      params: projectParams,
      body: z.object({ reason: z.string().trim().min(10).max(1000) }).strict(),
    },
    responses: { 200: adminProjectDetailSchema },
  }),
  adminReopenScope: defineRoute({
    method: 'post',
    path: '/v1/admin/projects/{projectId}/reopen',
    operationId: 'adminReopenProjectScope',
    summary: 'Volta um escopo aprovado para edição (antes de a distribuição começar).',
    tags: ['admin', 'projects'],
    auth: adminScope,
    request: { params: projectParams },
    responses: { 200: adminProjectDetailSchema },
  }),
  adminScopingMetrics: defineRoute({
    method: 'get',
    path: '/v1/admin/metrics/scoping',
    operationId: 'adminScopingMetrics',
    summary: 'Fila e tempos de escopo, e desvio entre a estimativa da IA e o escopo aprovado.',
    tags: ['admin', 'projects'],
    auth: adminRead,
    request: {},
    responses: { 200: scopingMetricsSchema },
  }),
} as const;
