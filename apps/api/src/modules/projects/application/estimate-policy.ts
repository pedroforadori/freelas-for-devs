import type { ClarificationQuestion, Estimate, Level, Stack } from '@f4d/contracts';

const MAX_ITEMS = { features: 15, assumptions: 8, risks: 8, reviewNotes: 5, stacks: 8 } as const;
const MAX_QUESTIONS = 3;
const MAX_TEXT = 300;

const clip = (text: string, max = MAX_TEXT) => text.trim().slice(0, max);
const clipList = (items: string[], max: number) =>
  items
    .map((item) => clip(item))
    .filter(Boolean)
    .slice(0, max);

/**
 * A saída da IA é dado não confiável: mesmo validada pelo schema, passa por estas regras antes de
 * ser gravada — nível e stacks só do catálogo, faixas coerentes e listas com tamanho limitado.
 */
export const normalizeEstimate = (
  estimate: Estimate,
  catalog: { levels: Level[]; stacks: Stack[] },
): Estimate => {
  const levels = [...catalog.levels].sort((a, b) => a.rank - b.rank);
  const knownStacks = new Set(catalog.stacks.map((stack) => stack.slug));
  const level = levels.find((candidate) => candidate.slug === estimate.suggestedLevel) ?? levels[0];

  const [minCents, maxCents] = [estimate.priceRange.minCents, estimate.priceRange.maxCents].sort(
    (a, b) => a - b,
  ) as [number, number];
  const [minDays, maxDays] = [estimate.durationDays.min, estimate.durationDays.max]
    .map((days) => Math.max(1, Math.round(days)))
    .sort((a, b) => a - b) as [number, number];

  return {
    summary: clip(estimate.summary, 1000),
    priceRange: { minCents: roundToHundreds(minCents), maxCents: roundToHundreds(maxCents) },
    durationDays: { min: minDays, max: maxDays },
    features: clipList(estimate.features, MAX_ITEMS.features),
    assumptions: clipList(estimate.assumptions, MAX_ITEMS.assumptions),
    suggestedType: estimate.suggestedType,
    complexity: estimate.complexity,
    suggestedLevel: level?.slug ?? estimate.suggestedLevel,
    suggestedStacks: [...new Set(estimate.suggestedStacks)]
      .filter((slug) => knownStacks.has(slug))
      .slice(0, MAX_ITEMS.stacks),
    risks: clipList(estimate.risks, MAX_ITEMS.risks),
    reviewNotes: clipList(estimate.reviewNotes, MAX_ITEMS.reviewNotes),
  };
};

/** Valores "redondos" (R$ 100) comunicam que é uma faixa, não um orçamento fechado. */
const roundToHundreds = (cents: number) => Math.round(cents / 10_000) * 10_000;

/** Ids estáveis e curtos (q1, q2 / a, b, c) independentemente do que a IA gerou. */
export const normalizeQuestions = (questions: ClarificationQuestion[]): ClarificationQuestion[] =>
  questions.slice(0, MAX_QUESTIONS).map((question, index) => ({
    id: `q${index + 1}`,
    question: clip(question.question),
    options: question.options.slice(0, 5).map((option, optionIndex) => ({
      id: String.fromCharCode(97 + optionIndex),
      label: clip(option.label, 120),
    })),
    allowOther: question.allowOther,
  }));
