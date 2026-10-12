import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { defineRoute } from '../http/route.js';

/** Como o painel exibe e edita o valor (a API sempre guarda o valor bruto: centavos, bps, horas). */
export type SettingInput =
  | { kind: 'integer'; unit: 'horas' | 'dias' | 'convites' | 'rodadas' }
  | { kind: 'money' }
  | { kind: 'percent' }
  | { kind: 'enum'; options: readonly { value: string; label: string }[] };

interface SettingDefinition<T extends z.ZodType> {
  schema: T;
  default: z.output<T>;
  label: string;
  description: string;
  input: SettingInput;
  /** Fase em que o valor passa a ter efeito (os demais já podem ser ajustados). */
  usedFrom: string;
}

const define = <T extends z.ZodType>(definition: SettingDefinition<T>) => definition;

export const CommissionPayer = {
  Client: 'CLIENT',
  Freelancer: 'FREELANCER',
  Split: 'SPLIT',
} as const;
export type CommissionPayer = (typeof CommissionPayer)[keyof typeof CommissionPayer];

/**
 * Parâmetros de negócio editáveis pelo Admin (docs/architecture.md §6 e §10c). Cada valor tem
 * schema, padrão e versão; prazos e percentuais são copiados (snapshot) para a rodada ou o
 * contrato no momento da criação — mudar aqui só afeta o que for criado depois.
 */
export const SETTINGS = {
  'scope.minPriceCents': define({
    schema: z.number().int().min(10_000).max(100_000_000),
    default: 50_000,
    label: 'Valor mínimo de projeto',
    description: 'Menor valor de faixa aceito ao aprovar um escopo.',
    input: { kind: 'money' },
    usedFrom: 'F4',
  }),
  'scope.maxDeadlineDays': define({
    schema: z.number().int().min(7).max(730),
    default: 365,
    label: 'Prazo máximo de projeto',
    description: 'Maior prazo de entrega aceito ao aprovar um escopo.',
    input: { kind: 'integer', unit: 'dias' },
    usedFrom: 'F4',
  }),
  'payments.commissionBps': define({
    schema: z.number().int().min(0).max(5_000),
    default: 1_000,
    label: 'Comissão da plataforma',
    description: 'Percentual sobre o valor do contrato (ADR-0012).',
    input: { kind: 'percent' },
    usedFrom: 'F6',
  }),
  'payments.commissionPayer': define({
    schema: z.enum(['CLIENT', 'FREELANCER', 'SPLIT']),
    default: 'FREELANCER',
    label: 'Quem paga a comissão',
    description: 'Somada ao valor do cliente, descontada do freelancer ou dividida entre os dois.',
    input: {
      kind: 'enum',
      options: [
        { value: 'CLIENT', label: 'Cliente' },
        { value: 'FREELANCER', label: 'Freelancer' },
        { value: 'SPLIT', label: 'Dividida' },
      ],
    },
    usedFrom: 'F6',
  }),
  'queue.roundSize': define({
    schema: z.number().int().min(1).max(50),
    default: 10,
    label: 'Convites ativos por rodada (K)',
    description: 'Quantos freelancers são convidados ao mesmo tempo para cada projeto.',
    input: { kind: 'integer', unit: 'convites' },
    usedFrom: 'F5',
  }),
  'queue.maxInvitesPerRound': define({
    schema: z.number().int().min(1).max(200),
    default: 30,
    label: 'Teto de convites por projeto',
    description: 'Limite total de convites de uma rodada, contando as vagas repostas.',
    input: { kind: 'integer', unit: 'convites' },
    usedFrom: 'F5',
  }),
  'queue.maxOpenInvitesPerFreelancer': define({
    schema: z.number().int().min(1).max(20),
    default: 3,
    label: 'Convites abertos por freelancer',
    description: 'Acima disso o freelancer não recebe novos convites até responder os atuais.',
    input: { kind: 'integer', unit: 'convites' },
    usedFrom: 'F5',
  }),
  'queue.inviteResponseHours': define({
    schema: z.number().int().min(1).max(168),
    default: 48,
    label: 'Prazo para responder ao convite',
    description: 'Sem resposta nesse prazo, o freelancer perde a vez e a vaga é reposta.',
    input: { kind: 'integer', unit: 'horas' },
    usedFrom: 'F5',
  }),
  'queue.roundsBeforeMonitoring': define({
    schema: z.number().int().min(1).max(50),
    default: 5,
    label: 'Rodadas sem escolha até acompanhamento',
    description: 'Depois disso o freelancer sai da fila e entra em acompanhamento pelo Admin.',
    input: { kind: 'integer', unit: 'rodadas' },
    usedFrom: 'F5',
  }),
  'payments.paymentDeadlineHours': define({
    schema: z.number().int().min(1).max(336),
    default: 72,
    label: 'Prazo de pagamento após a escolha',
    description:
      'Sem pagamento nesse prazo, a escolha expira e o cliente pode escolher outra proposta.',
    input: { kind: 'integer', unit: 'horas' },
    usedFrom: 'F6',
  }),
  'delivery.reviewDays': define({
    schema: z.number().int().min(1).max(30),
    default: 5,
    label: 'Prazo de revisão das entregas 1 e 2',
    description: 'Sem resposta do cliente, a entrega avança sem ajustes.',
    input: { kind: 'integer', unit: 'dias' },
    usedFrom: 'F7',
  }),
  'moderation.warnAfterViolations': define({
    schema: z.number().int().min(1).max(20),
    default: 2,
    label: 'Advertência após tentativas de contato',
    description: 'Tentativas de passar contato (30 dias) até o usuário receber uma advertência.',
    input: { kind: 'integer', unit: 'rodadas' },
    usedFrom: 'F3',
  }),
  'moderation.alertAfterViolations': define({
    schema: z.number().int().min(1).max(50),
    default: 4,
    label: 'Alerta ao Admin após tentativas de contato',
    description: 'A partir daqui o caso aparece em destaque na moderação para decidir a suspensão.',
    input: { kind: 'integer', unit: 'rodadas' },
    usedFrom: 'F3',
  }),
  'delivery.finalCorrectionsMax': define({
    schema: z.number().int().min(0).max(5),
    default: 1,
    label: 'Correções pontuais na entrega final',
    description: 'Quantas vezes o cliente pode pedir a correção de um ajuste já combinado.',
    input: { kind: 'integer', unit: 'rodadas' },
    usedFrom: 'F7',
  }),
  'delivery.autoApproveDays': define({
    schema: z.number().int().min(1).max(30),
    default: 7,
    label: 'Aprovação automática da entrega final',
    description: 'Sem resposta do cliente, a entrega final é aprovada e o pagamento liberado.',
    input: { kind: 'integer', unit: 'dias' },
    usedFrom: 'F7',
  }),
  'dispute.evidenceDays': define({
    schema: z.number().int().min(1).max(14),
    default: 3,
    label: 'Prazo para as partes se manifestarem na disputa',
    description: 'Depois dele (ou quando as duas partes enviarem sua versão), a mediação analisa.',
    input: { kind: 'integer', unit: 'dias' },
    usedFrom: 'F8',
  }),
  'queue.abandonPenaltyDays': define({
    schema: z.number().int().min(0).max(180),
    default: 30,
    label: 'Penalidade na fila por abandono',
    description:
      'Quem abandona um contrato vai para o fim da fila e só volta a ser convidado depois disso.',
    input: { kind: 'integer', unit: 'dias' },
    usedFrom: 'F8',
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS)[K]['schema']>;
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export const settingKeySchema = z.enum(Object.keys(SETTINGS) as [SettingKey, ...SettingKey[]]);

export const settingSchema = z
  .object({
    key: settingKeySchema,
    value: z.unknown(),
    defaultValue: z.unknown(),
    label: z.string(),
    description: z.string(),
    usedFrom: z.string(),
    /** 0 = nunca alterado (vale o padrão). */
    version: z.number().int(),
    updatedAt: z.iso.datetime().nullable(),
    updatedBy: z.string().nullable(),
  })
  .meta({ id: 'Setting' });

export const updateSettingRequestSchema = z
  .object({
    value: z.unknown(),
    /** Lock otimista: a versão que o Admin estava vendo. */
    expectedVersion: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'UpdateSettingRequest' });

export type Setting = z.infer<typeof settingSchema>;

const settingsWrite = { permission: Permission.AdminSettingsWrite } as const;

export const settingRoutes = {
  adminListSettings: defineRoute({
    method: 'get',
    path: '/v1/admin/settings',
    operationId: 'adminListSettings',
    summary: 'Parâmetros de negócio com valor atual, padrão e versão.',
    tags: ['admin', 'settings'],
    auth: settingsWrite,
    request: {},
    responses: { 200: z.object({ items: z.array(settingSchema) }) },
  }),
  adminUpdateSetting: defineRoute({
    method: 'put',
    path: '/v1/admin/settings/{key}',
    operationId: 'adminUpdateSetting',
    summary: 'Altera um parâmetro (validado pelo schema da chave; auditado).',
    tags: ['admin', 'settings'],
    auth: settingsWrite,
    request: { params: z.object({ key: settingKeySchema }), body: updateSettingRequestSchema },
    responses: { 200: settingSchema },
  }),
} as const;
