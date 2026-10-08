import type Anthropic from '@anthropic-ai/sdk';
import { complexitySchema, type Level, projectTypeSchema, type Stack } from '@f4d/contracts';
import { z } from 'zod';
import type { EstimatorRun, ProjectEstimator } from '../../application/ports.js';
import type { EstimationBrief } from '../../domain/project.js';
import { clarifyTool, estimateTool, PROMPT_VERSION, renderBrief, systemPrompt } from './prompt.js';

const MAX_OUTPUT_TOKENS = 2_000;

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
 * Estimativa com Claude via tool use estrito (docs/architecture.md §1). A descrição do cliente vai
 * delimitada como dado; a saída é validada por schema antes de virar sugestão para o Admin.
 */
export class ClaudeProjectEstimator implements ProjectEstimator {
  readonly promptVersion = PROMPT_VERSION;

  constructor(
    private readonly client: Pick<Anthropic, 'messages'>,
    readonly model: string,
  ) {}

  async estimate(
    brief: EstimationBrief,
    context: { levels: Level[]; stacks: Stack[] },
  ): Promise<EstimatorRun> {
    const submitEstimate = estimateTool(context.levels, context.stacks);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt(context.levels),
      tools: brief.allowQuestions ? [submitEstimate, clarifyTool] : [submitEstimate],
      // Na 2ª rodada não há escolha: a IA precisa estimar.
      tool_choice: brief.allowQuestions
        ? { type: 'any' }
        : { type: 'tool', name: submitEstimate.name },
      messages: [{ role: 'user', content: renderBrief(brief) }],
    });

    const usage = {
      model: response.model,
      promptVersion: this.promptVersion,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
    const call = response.content.find((block) => block.type === 'tool_use');
    if (!call) throw new EstimatorOutputError(`Resposta sem ferramenta (${response.stop_reason}).`);

    if (call.name === clarifyTool.name) {
      const parsed = clarifyInput.safeParse(call.input);
      if (!parsed.success) throw new EstimatorOutputError('Perguntas fora do formato esperado.');
      return {
        usage,
        outcome: {
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
        },
      };
    }

    const parsed = estimateInput.safeParse(call.input);
    if (!parsed.success) throw new EstimatorOutputError('Estimativa fora do formato esperado.');
    const input = parsed.data;
    return {
      usage,
      outcome: {
        kind: 'estimate',
        estimate: {
          summary: input.summary,
          priceRange: { minCents: input.priceMinBrl * 100, maxCents: input.priceMaxBrl * 100 },
          durationDays: { min: input.durationMinDays, max: input.durationMaxDays },
          features: input.features,
          assumptions: input.assumptions,
          suggestedType: input.suggestedType,
          complexity: input.complexity,
          suggestedLevel: input.suggestedLevel,
          suggestedStacks: input.suggestedStacks,
          risks: input.risks,
          reviewNotes: input.reviewNotes,
        },
      },
    };
  }
}
