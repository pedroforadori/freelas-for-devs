import { z } from 'zod';

const csv = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

/**
 * Variáveis de ambiente validadas no boot (fail-fast). Segredos nunca têm default.
 * Referência completa em `.env.example` na raiz do repositório.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_VERSION: z.string().default('0.0.0-dev'),
    PORT: z.coerce.number().int().positive().default(3333),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    /** Origens permitidas no CORS, separadas por vírgula. Nunca usar `*` (cookies httpOnly). */
    CORS_ORIGINS: csv.pipe(z.array(z.url()).min(1)),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),

    SENTRY_DSN: z.url().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),

    /** URL do apps/web, usada nos links enviados por e-mail. */
    WEB_APP_URL: z.url().default('http://localhost:3000'),
    /** URL pública desta API (callbacks do OAuth). */
    API_PUBLIC_URL: z.url().default('http://localhost:3333'),

    /** Login social: cada provedor só é habilitado com as duas variáveis definidas. */
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    /** Ed25519 PKCS#8 em PEM (aceita `\n` escapado). Gere com `pnpm --filter @f4d/api keys:generate`. */
    JWT_PRIVATE_KEY: z.string().min(1).optional(),
    JWT_KEY_ID: z
      .string()
      .regex(/^[\w-]{1,32}$/)
      .default('k1'),
    /** JSON `[{"kid":"k0","pem":"-----BEGIN PUBLIC KEY-----..."}]` com chaves ainda aceitas na rotação. */
    JWT_PREVIOUS_PUBLIC_KEYS: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (!value) return [];
        try {
          return z.array(z.object({ kid: z.string(), pem: z.string() })).parse(JSON.parse(value));
        } catch {
          ctx.addIssue({ code: 'custom', message: 'JSON inválido' });
          return z.NEVER;
        }
      }),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    /** `false` só em desenvolvimento local via http. */
    COOKIE_SECURE: z.stringbool().default(true),
    /** Domínio pai para o cookie CSRF ser legível pelo web (ex.: `.freelas4devs.com.br`). */
    COOKIE_DOMAIN: z.string().optional(),

    /** AES-256 (32 bytes em base64) para campos sensíveis em repouso. `openssl rand -base64 32` */
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, {
        message: 'deve ter 32 bytes em base64',
      })
      .optional(),
    FIELD_ENCRYPTION_KEY_ID: z
      .string()
      .regex(/^[\w-]{1,16}$/)
      .default('k1'),
    /** Chaves anteriores ainda usadas para decifrar: `k0:<base64>,k-1:<base64>`. */
    FIELD_ENCRYPTION_PREVIOUS_KEYS: csv.default([]).transform((items) =>
      items.map((item) => {
        const [id = '', key = ''] = item.split(':');
        return { id, key };
      }),
    ),

    /** Storage S3-compatível: Cloudflare R2 em produção, MinIO em dev (ver infra/docker-compose.yml). */
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default('auto'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET_QUARANTINE: z.string().default('f4d-quarantine'),
    S3_BUCKET_FILES: z.string().default('f4d-files'),
    /** true para MinIO; R2/S3 usam virtual-hosted style. */
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),

    /** Antivírus dos uploads. `disabled` só em desenvolvimento. */
    MALWARE_SCAN: z.enum(['clamav', 'disabled']).default('disabled'),
    CLAMAV_HOST: z.string().default('localhost'),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),

    /** Cloudflare Turnstile (anti-bot dos formulários públicos). */
    TURNSTILE_SECRET_KEY: z.string().optional(),

    /**
     * Provedor da estimativa dos projetos (ADR-0014): `gemini` em produção, `anthropic` como
     * alternativa e `heuristic` (sem IA) só em desenvolvimento e testes.
     */
    ESTIMATOR: z.enum(['gemini', 'anthropic', 'heuristic']).default('heuristic'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
    /** Tempo máximo de uma chamada à IA; o job é repetido em caso de falha. */
    ESTIMATOR_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(60_000),

    MAIL_TRANSPORT: z.enum(['log', 'smtp', 'resend']).default('log'),
    MAIL_FROM: z.string().default('Freelas 4 Devs <nao-responda@freelas4devs.com.br>'),
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    RESEND_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.ESTIMATOR === 'gemini' && !env.GEMINI_API_KEY)
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'obrigatório com ESTIMATOR=gemini',
      });
    if (env.ESTIMATOR === 'anthropic' && !env.ANTHROPIC_API_KEY)
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'obrigatório com ESTIMATOR=anthropic',
      });
    if (env.NODE_ENV !== 'production') return;
    if (env.ESTIMATOR === 'heuristic')
      ctx.addIssue({
        code: 'custom',
        path: ['ESTIMATOR'],
        message: 'a estimativa heurística não serve para clientes reais',
      });
    // Em produção, nada de defaults inseguros.
    if (!env.JWT_PRIVATE_KEY)
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_PRIVATE_KEY'],
        message: 'obrigatório em produção',
      });
    if (!env.FIELD_ENCRYPTION_KEY)
      ctx.addIssue({
        code: 'custom',
        path: ['FIELD_ENCRYPTION_KEY'],
        message: 'obrigatório em produção',
      });
    if (!env.COOKIE_SECURE)
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'deve ser true em produção',
      });
    if (env.MALWARE_SCAN !== 'clamav')
      ctx.addIssue({
        code: 'custom',
        path: ['MALWARE_SCAN'],
        message: 'uploads exigem antivírus em produção',
      });
    if (!env.TURNSTILE_SECRET_KEY)
      ctx.addIssue({
        code: 'custom',
        path: ['TURNSTILE_SECRET_KEY'],
        message: 'formulários públicos exigem anti-bot em produção',
      });
    if (env.MAIL_TRANSPORT === 'log')
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message: 'log não entrega e-mails em produção',
      });
  });

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(issues: readonly z.core.$ZodIssue[]) {
    const lines = issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    super(`Variáveis de ambiente inválidas:\n${lines.join('\n')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw new InvalidEnvironmentError(parsed.error.issues);
  return parsed.data;
};
