import type { PromotionCriterion, PromotionRule } from '@f4d/contracts';

/** Contagens brutas que vêm de contratos, avaliações, convites e disputas. */
export interface RawStats {
  completedContracts: number;
  startedContracts: number;
  ratingCount: number;
  ratingSum: number;
  onTimeContracts: number;
  abandonments: number;
  invitationsAnswered: number;
  invitationsExpired: number;
}

export interface ScoreComponents {
  rating: number;
  onTime: number;
  reliability: number;
  responsiveness: number;
}

/** Peso de cada componente no score (soma 1). Nota do cliente pesa mais; responder rápido, menos. */
export const SCORE_WEIGHTS: Readonly<ScoreComponents> = {
  rating: 0.35,
  onTime: 0.25,
  reliability: 0.25,
  responsiveness: 0.15,
};

/**
 * Suavização bayesiana: cada componente começa em 0,5 com o peso de 4 observações "neutras".
 * Sem histórico, o score é exatamente 0,5 — o iniciante não é penalizado por ser novo — e poucos
 * dados mexem pouco (uma nota 5 isolada não vale tanto quanto dez).
 */
export const PRIOR_WEIGHT = 4;
const NEUTRAL = 0.5;

const smooth = (successes: number, observations: number): number =>
  (successes + PRIOR_WEIGHT * NEUTRAL) / (observations + PRIOR_WEIGHT);

const round = (value: number) => Math.round(value * 10_000) / 10_000;

export const computeScore = (raw: RawStats): { score: number; components: ScoreComponents } => {
  const components: ScoreComponents = {
    // Nota 1–5 vira 0–1 por avaliação.
    rating: smooth((raw.ratingSum - raw.ratingCount) / 4, raw.ratingCount),
    onTime: smooth(raw.onTimeContracts, raw.completedContracts),
    reliability: smooth(Math.max(0, raw.startedContracts - raw.abandonments), raw.startedContracts),
    responsiveness: smooth(
      raw.invitationsAnswered,
      raw.invitationsAnswered + raw.invitationsExpired,
    ),
  };
  const score = (Object.keys(SCORE_WEIGHTS) as (keyof ScoreComponents)[]).reduce(
    (sum, key) => sum + SCORE_WEIGHTS[key] * components[key],
    0,
  );
  return {
    score: round(score),
    components: {
      rating: round(components.rating),
      onTime: round(components.onTime),
      reliability: round(components.reliability),
      responsiveness: round(components.responsiveness),
    },
  };
};

export const ratingAvg = (raw: RawStats): number | null =>
  raw.ratingCount === 0 ? null : Math.round((raw.ratingSum / raw.ratingCount) * 100) / 100;

export const onTimeRate = (raw: RawStats): number | null =>
  raw.completedContracts === 0
    ? null
    : Math.round((raw.onTimeContracts / raw.completedContracts) * 10_000) / 10_000;

export const responseRate = (raw: RawStats): number | null => {
  const total = raw.invitationsAnswered + raw.invitationsExpired;
  return total === 0 ? null : Math.round((raw.invitationsAnswered / total) * 10_000) / 10_000;
};

export interface CriterionProgress {
  criterion: PromotionCriterion;
  required: number;
  current: number | null;
  met: boolean;
}

/** Cada critério da regra com o valor atual. Sem dado (ex.: nenhuma nota), o critério não é atendido. */
export const evaluatePromotion = (
  raw: RawStats,
  score: number,
  rule: PromotionRule,
): { eligible: boolean; criteria: CriterionProgress[] } => {
  const rating = ratingAvg(raw);
  const onTime = onTimeRate(raw);
  const criteria: CriterionProgress[] = [
    {
      criterion: 'COMPLETED',
      required: rule.minCompleted,
      current: raw.completedContracts,
      met: raw.completedContracts >= rule.minCompleted,
    },
    {
      criterion: 'RATING',
      required: rule.minRatingAvg,
      current: rating,
      met: rating !== null && rating >= rule.minRatingAvg,
    },
    {
      criterion: 'ON_TIME',
      required: rule.minOnTimeRate,
      current: onTime,
      met: onTime !== null && onTime >= rule.minOnTimeRate,
    },
    { criterion: 'SCORE', required: rule.minScore, current: score, met: score >= rule.minScore },
    {
      criterion: 'ABANDONMENTS',
      required: rule.maxAbandonments,
      current: raw.abandonments,
      met: raw.abandonments <= rule.maxAbandonments,
    },
  ];
  return { eligible: criteria.every((item) => item.met), criteria };
};
