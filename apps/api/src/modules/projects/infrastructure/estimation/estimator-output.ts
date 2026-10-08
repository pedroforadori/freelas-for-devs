import { complexitySchema, projectTypeSchema } from '@f4d/contracts';
import { z } from 'zod';
import type { EstimatorOutcome } from '../../application/ports.js';
import { CLARIFY_TOOL, ESTIMATE_TOOL } from './prompt.js';

const estimateInput = z.object({
  summary: z.string().min(1),
  suggestedType: projectTypeSchema,
  complexity: complexitySchema,
  suggestedLevel: z.string(),
  priceMinBrl: z.number().int().positive(),
  priceMaxBrl: z.number().int().positive(),
  durationMinDays: z.number().int().positive(),
  durationMaxDays: z.number().int().positive(),
  features: z.array(z.string()).min(1),
  assumptions: z.array(z.string()),
  suggestedStacks: z.array(z.string()),
  risks: z.array(z.string()),
  reviewNotes: z.array(z.string()),
});

const clarifyInput = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        options: z.array(z.string().min(1)).min(2).max(5),
        allowOther: z.boolean(),
      }),
    )
    .min(1)
    .max(3),
});

/** Resposta da IA fora do contrato: o job é repetido (e, no limite, o especialista estima). */
export class EstimatorOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EstimatorOutputError';
  }
}

/**
 * Converte a chamada de ferramenta devolvida pelo modelo (qualquer provedor) no resultado do
 * domínio, validando o formato. Valores em reais viram centavos; opções ganham ids estáveis.
 */
export const toEstimatorOutcome = (toolName: string, input: unknown): EstimatorOutcome => {
  if (toolName === CLARIFY_TOOL) {
    const parsed = clarifyInput.safeParse(input);
    if (!parsed.success) throw new EstimatorOutputError('Perguntas fora do formato esperado.');
    return {
      kind: 'clarify',
      questions: parsed.data.questions.map((question, index) => ({
        id: `q${index + 1}`,
        question: question.question,
        options: question.options.map((label, optionIndex) => ({
          id: String.fromCharCode(97 + optionIndex),
          label,
        })),
        allowOther: question.allowOther,
      })),
    };
  }
  if (toolName !== ESTIMATE_TOOL)
    throw new EstimatorOutputError(`Ferramenta desconhecida: ${toolName}.`);

  const parsed = estimateInput.safeParse(input);
  if (!parsed.success) throw new EstimatorOutputError('Estimativa fora do formato esperado.');
  const data = parsed.data;
  return {
    kind: 'estimate',
    estimate: {
      summary: data.summary,
      priceRange: { minCents: data.priceMinBrl * 100, maxCents: data.priceMaxBrl * 100 },
      durationDays: { min: data.durationMinDays, max: data.durationMaxDays },
      features: data.features,
      assumptions: data.assumptions,
      suggestedType: data.suggestedType,
      complexity: data.complexity,
      suggestedLevel: data.suggestedLevel,
      suggestedStacks: data.suggestedStacks,
      risks: data.risks,
      reviewNotes: data.reviewNotes,
    },
  };
};
