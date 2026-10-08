import type { Complexity, Level, ProjectType, Stack } from '@f4d/contracts';
import type { EstimatorRun, ProjectEstimator } from '../../application/ports.js';
import type { EstimationBrief } from '../../domain/project.js';

/** Faixas base por tipo (R$ e dias), as mesmas âncoras do prompt da IA. */
const BASE: Record<ProjectType, { price: [number, number]; days: [number, number] }> = {
  SITE: { price: [1_500, 5_000], days: [7, 25] },
  ECOMMERCE: { price: [4_000, 15_000], days: [20, 60] },
  APP: { price: [12_000, 45_000], days: [45, 110] },
  SYSTEM: { price: [8_000, 35_000], days: [30, 100] },
  OTHER: { price: [1_500, 10_000], days: [7, 40] },
};

/** Sinais de complexidade no texto do cliente. */
const SIGNALS = [
  /pagamento|pix|cart[aã]o|checkout|assinatura/i,
  /login|cadastro de usu[aá]rio|[aá]rea do cliente|conta/i,
  /integra[çc][aã]o|api|erp|crm|whatsapp/i,
  /painel|dashboard|relat[oó]rio|admin/i,
  /tempo real|chat|notifica[çc]/i,
  /mapa|geolocaliza|agendamento|reserva/i,
];

const MULTIPLIER: Record<Complexity, number> = { LOW: 1, MEDIUM: 1.6, HIGH: 2.6 };

/** Abaixo disso, a descrição é vaga demais para estimar sem perguntar. */
const VAGUE_BELOW_CHARS = 160;

/**
 * Estimador determinístico, sem IA: atende desenvolvimento local e testes (ESTIMATOR=heuristic).
 * Em produção, o adapter Claude é obrigatório.
 */
export class HeuristicProjectEstimator implements ProjectEstimator {
  readonly model = 'heuristic';
  readonly promptVersion = 'heuristic-v1';

  estimate(brief: EstimationBrief, context: { levels: Level[]; stacks: Stack[] }) {
    const text = `${brief.title}\n${brief.description}\n${brief.clarifications.map((c) => c.answer).join('\n')}`;
    const usage = {
      model: this.model,
      promptVersion: this.promptVersion,
      inputTokens: 0,
      outputTokens: 0,
    };

    if (brief.allowQuestions && brief.description.length < VAGUE_BELOW_CHARS) {
      return Promise.resolve<EstimatorRun>({
        usage,
        outcome: {
          kind: 'clarify',
          questions: [
            {
              id: 'q1',
              question: 'Quem vai usar o que será construído?',
              options: [
                { id: 'a', label: 'Só minha equipe' },
                { id: 'b', label: 'Meus clientes' },
                { id: 'c', label: 'Os dois' },
              ],
              allowOther: false,
            },
            {
              id: 'q2',
              question: 'Vai precisar receber pagamentos online?',
              options: [
                { id: 'a', label: 'Sim' },
                { id: 'b', label: 'Não' },
                { id: 'c', label: 'Ainda não sei' },
              ],
              allowOther: true,
            },
          ],
        },
      });
    }

    const signals = SIGNALS.filter((signal) => signal.test(text)).length;
    const complexity: Complexity = signals >= 3 ? 'HIGH' : signals >= 1 ? 'MEDIUM' : 'LOW';
    const base = BASE[brief.type];
    const factor = MULTIPLIER[complexity];
    const levels = [...context.levels].sort((a, b) => a.rank - b.rank);
    const level = levels[{ LOW: 0, MEDIUM: 1, HIGH: 2 }[complexity]] ?? levels.at(-1);

    return Promise.resolve<EstimatorRun>({
      usage,
      outcome: {
        kind: 'estimate',
        estimate: {
          summary: `Estimativa automática para "${brief.title}", baseada no tipo de projeto e nas funcionalidades citadas.`,
          priceRange: {
            minCents: Math.round(base.price[0] * factor) * 100,
            maxCents: Math.round(base.price[1] * factor) * 100,
          },
          durationDays: {
            min: Math.round(base.days[0] * factor),
            max: Math.round(base.days[1] * factor),
          },
          features: ['Funcionalidades a detalhar no escopo com o especialista'],
          assumptions: ['Estimativa heurística (sem IA): referência apenas para desenvolvimento.'],
          suggestedType: brief.type,
          complexity,
          suggestedLevel: level?.slug ?? 'iniciante',
          suggestedStacks: [],
          risks: [],
          reviewNotes: [],
        },
      },
    });
  }
}
