import type Anthropic from '@anthropic-ai/sdk';
import type { Level, Stack } from '@f4d/contracts';
import type { EstimatorRun, ProjectEstimator } from '../../application/ports.js';
import type { EstimationBrief } from '../../domain/project.js';
import { EstimatorOutputError, toEstimatorOutcome } from './estimator-output.js';
import { ESTIMATE_TOOL, PROMPT_VERSION, renderBrief, systemPrompt, toolsFor } from './prompt.js';

const MAX_OUTPUT_TOKENS = 2_000;

/**
 * Estimativa com Claude via tool use estrito (ADR-0013). Alternativa ao Gemini (ADR-0014),
 * selecionada com ESTIMATOR=anthropic.
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
    const tools = toolsFor(brief.allowQuestions, context.levels, context.stacks);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemPrompt(context.levels),
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
        strict: true,
      })),
      // Na 2ª rodada não há escolha: a IA precisa estimar.
      tool_choice: brief.allowQuestions ? { type: 'any' } : { type: 'tool', name: ESTIMATE_TOOL },
      messages: [{ role: 'user', content: renderBrief(brief) }],
    });

    const call = response.content.find((block) => block.type === 'tool_use');
    if (!call) throw new EstimatorOutputError(`Resposta sem ferramenta (${response.stop_reason}).`);
    return {
      outcome: toEstimatorOutcome(call.name, call.input),
      usage: {
        model: response.model,
        promptVersion: this.promptVersion,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
