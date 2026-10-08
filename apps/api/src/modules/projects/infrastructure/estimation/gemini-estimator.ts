import type { Level, Stack } from '@f4d/contracts';
import { FunctionCallingConfigMode, type GoogleGenAI } from '@google/genai';
import type { EstimatorRun, ProjectEstimator } from '../../application/ports.js';
import type { EstimationBrief } from '../../domain/project.js';
import { EstimatorOutputError, toEstimatorOutcome } from './estimator-output.js';
import { PROMPT_VERSION, renderBrief, systemPrompt, toolsFor } from './prompt.js';

/**
 * Teto de saída. Modelos Gemini 3 raciocinam antes de responder e esse raciocínio conta no
 * limite: folga suficiente para não cortar a chamada de função.
 */
const MAX_OUTPUT_TOKENS = 8_192;

/**
 * Estimativa com Gemini via function calling obrigatório (ADR-0014): o modo ANY força o modelo a
 * chamar uma das funções oferecidas — na 2ª rodada, só a de estimativa existe.
 */
export class GeminiProjectEstimator implements ProjectEstimator {
  readonly promptVersion = PROMPT_VERSION;

  constructor(
    private readonly client: Pick<GoogleGenAI, 'models'>,
    readonly model: string,
  ) {}

  async estimate(
    brief: EstimationBrief,
    context: { levels: Level[]; stacks: Stack[] },
  ): Promise<EstimatorRun> {
    const tools = toolsFor(brief.allowQuestions, context.levels, context.stacks);
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text: renderBrief(brief) }] }],
      config: {
        systemInstruction: systemPrompt(context.levels),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        tools: [
          {
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            })),
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: tools.map((tool) => tool.name),
          },
        },
      },
    });

    const usage = response.usageMetadata;
    const call = response.functionCalls?.[0];
    if (!call?.name) {
      const reason = response.candidates?.[0]?.finishReason ?? 'sem candidato';
      throw new EstimatorOutputError(`Resposta sem chamada de função (${reason}).`);
    }
    return {
      outcome: toEstimatorOutcome(call.name, call.args),
      usage: {
        model: response.modelVersion ?? this.model,
        promptVersion: this.promptVersion,
        inputTokens: usage?.promptTokenCount ?? 0,
        // Raciocínio é cobrado como saída.
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      },
    };
  }
}
