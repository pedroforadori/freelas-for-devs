import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { defineRoute, noContent } from '../http/route.js';
import { levelSchema } from './catalog.js';

/**
 * Reputação e níveis (docs/architecture.md §6 passo 10; F9). O score (0–1) ajusta a vez na fila
 * e, com as estatísticas, decide a progressão de nível conforme regras configuráveis por nível.
 */

/** Regra para subir DESTE nível para o próximo. Todos os critérios precisam ser atendidos. */
export const promotionRuleSchema = z
  .object({
    minCompleted: z.number().int().min(0).max(1000),
    /** Média das avaliações dos clientes (1 a 5). */
    minRatingAvg: z.number().min(1).max(5),
    /** Fração dos contratos concluídos com a última entrega dentro do prazo (0 a 1). */
    minOnTimeRate: z.number().min(0).max(1),
    /** Score de desempenho (0 a 1; 0,5 é neutro). */
    minScore: z.number().min(0).max(1),
    maxAbandonments: z.number().int().min(0).max(100),
    /** Promove sozinho no job noturno; senão, aparece como sugestão para o Admin. */
    automatic: z.boolean(),
  })
  .strict()
  .meta({ id: 'PromotionRule' });

export const levelWithRuleSchema = z
  .object({
    level: levelSchema,
    nextLevel: levelSchema.nullable(),
    /** Nulo no nível mais alto ou quando a progressão está desligada. */
    promotion: promotionRuleSchema.nullable(),
    freelancers: z.number().int(),
  })
  .meta({ id: 'LevelWithRule' });

export const reputationStatsSchema = z
  .object({
    completedContracts: z.number().int(),
    startedContracts: z.number().int(),
    ratingCount: z.number().int(),
    ratingAvg: z.number().nullable(),
    onTimeRate: z.number().nullable(),
    abandonments: z.number().int(),
    /** Fração dos convites respondidos (proposta ou recusa) antes do prazo. */
    responseRate: z.number().nullable(),
    /** 0 a 1; sem histórico = 0,5 (neutro: iniciante não é penalizado). */
    score: z.number(),
    computedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'ReputationStats' });

export const PromotionCriterion = {
  Completed: 'COMPLETED',
  Rating: 'RATING',
  OnTime: 'ON_TIME',
  Score: 'SCORE',
  Abandonments: 'ABANDONMENTS',
} as const;
export type PromotionCriterion = (typeof PromotionCriterion)[keyof typeof PromotionCriterion];

export const PROMOTION_CRITERION_LABELS: Readonly<Record<PromotionCriterion, string>> = {
  COMPLETED: 'Projetos concluídos',
  RATING: 'Nota média dos clientes',
  ON_TIME: 'Entregas no prazo',
  SCORE: 'Desempenho geral',
  ABANDONMENTS: 'Projetos abandonados',
};

export const promotionProgressSchema = z
  .object({
    nextLevel: levelSchema,
    automatic: z.boolean(),
    eligible: z.boolean(),
    criteria: z.array(
      z.object({
        criterion: z.enum(['COMPLETED', 'RATING', 'ON_TIME', 'SCORE', 'ABANDONMENTS']),
        /** Mínimo exigido (no abandono, o máximo permitido). */
        required: z.number(),
        current: z.number().nullable(),
        met: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'PromotionProgress' });

export const reputationSchema = z
  .object({
    level: levelSchema.nullable(),
    stats: reputationStatsSchema,
    progress: promotionProgressSchema.nullable(),
    levelHistory: z.array(
      z.object({
        from: z.string().nullable(),
        to: z.string(),
        fromName: z.string().nullable(),
        toName: z.string(),
        reason: z.string(),
        automatic: z.boolean(),
        createdAt: z.iso.datetime(),
      }),
    ),
  })
  .meta({ id: 'Reputation' });

export const promotionSuggestionSchema = z
  .object({
    userId: z.uuid(),
    displayName: z.string(),
    level: levelSchema,
    nextLevel: levelSchema,
    stats: reputationStatsSchema,
  })
  .meta({ id: 'PromotionSuggestion' });

/** O que o cliente vê de cada proposta: histórico real, sem score interno. */
export const publicReputationSchema = z
  .object({
    completedContracts: z.number().int(),
    ratingAvg: z.number().nullable(),
    ratingCount: z.number().int(),
  })
  .meta({ id: 'PublicReputation' });

export type PromotionRule = z.infer<typeof promotionRuleSchema>;
export type LevelWithRule = z.infer<typeof levelWithRuleSchema>;
export type ReputationStats = z.infer<typeof reputationStatsSchema>;
export type PromotionProgress = z.infer<typeof promotionProgressSchema>;
export type Reputation = z.infer<typeof reputationSchema>;
export type PromotionSuggestion = z.infer<typeof promotionSuggestionSchema>;
export type PublicReputation = z.infer<typeof publicReputationSchema>;

const settings = { permission: Permission.AdminSettingsWrite } as const;
const review = { permission: Permission.AdminFreelancersReview } as const;

export const reputationRoutes = {
  getMyReputation: defineRoute({
    method: 'get',
    path: '/v1/me/reputation',
    operationId: 'getMyReputation',
    summary: 'Reputação do freelancer: estatísticas, progresso para o próximo nível e histórico.',
    tags: ['reputation'],
    auth: { permission: Permission.ProfileFreelancerWrite },
    request: {},
    responses: { 200: reputationSchema },
  }),
  adminFreelancerReputation: defineRoute({
    method: 'get',
    path: '/v1/admin/freelancers/{userId}/reputation',
    operationId: 'adminFreelancerReputation',
    summary: 'Reputação de um freelancer (estatísticas, progresso e histórico de nível).',
    tags: ['admin', 'reputation'],
    auth: review,
    request: { params: z.object({ userId: z.uuid() }) },
    responses: { 200: reputationSchema },
  }),
  adminListLevels: defineRoute({
    method: 'get',
    path: '/v1/admin/levels',
    operationId: 'adminListLevels',
    summary: 'Níveis com as regras de progressão e quantos freelancers há em cada um.',
    tags: ['admin', 'reputation'],
    auth: settings,
    request: {},
    responses: { 200: z.object({ items: z.array(levelWithRuleSchema) }) },
  }),
  adminUpdatePromotionRule: defineRoute({
    method: 'put',
    path: '/v1/admin/levels/{slug}/promotion',
    operationId: 'adminUpdatePromotionRule',
    summary: 'Define (ou desliga, com null) a regra para subir deste nível ao próximo.',
    tags: ['admin', 'reputation'],
    auth: settings,
    request: {
      params: z.object({ slug: z.string().max(50) }),
      body: z.object({ promotion: promotionRuleSchema.nullable() }).strict(),
    },
    responses: { 204: noContent },
  }),
  adminPromotionSuggestions: defineRoute({
    method: 'get',
    path: '/v1/admin/reputation/suggestions',
    operationId: 'adminPromotionSuggestions',
    summary: 'Freelancers que já cumprem a regra de um nível sem promoção automática.',
    tags: ['admin', 'reputation'],
    auth: review,
    request: {},
    responses: { 200: z.object({ items: z.array(promotionSuggestionSchema) }) },
  }),
  adminRecomputeReputation: defineRoute({
    method: 'post',
    path: '/v1/admin/reputation/recompute',
    operationId: 'adminRecomputeReputation',
    summary: 'Recalcula agora (o mesmo que o job noturno faz): estatísticas, scores e promoções.',
    tags: ['admin', 'reputation'],
    auth: settings,
    request: {},
    responses: {
      200: z.object({ recomputed: z.number().int(), promoted: z.number().int() }),
    },
  }),
} as const;
