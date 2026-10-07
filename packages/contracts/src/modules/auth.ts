import { z } from 'zod';
import { permissionSchema, roleSchema, selfAssignableRoleSchema } from '../auth/permissions.js';
import { defineRoute, noContent } from '../http/route.js';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .email({ error: 'Informe um e-mail válido.' })
  .max(254)
  .transform((value) => value.trim().toLowerCase());

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    error: `A senha precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  .max(PASSWORD_MAX_LENGTH);

/** Tokens de uso único (verificação de e-mail, reset de senha): base64url de 32 bytes. */
const oneTimeTokenSchema = z.string().regex(/^[\w-]{43}$/, { error: 'Link inválido.' });

/**
 * Cabeçalho que identifica clientes nativos (app mobile). Para eles, a API devolve os tokens no
 * corpo e espera `Authorization: Bearer` — sem cookies e, portanto, sem CSRF.
 */
export const CLIENT_KIND_HEADER = 'x-f4d-client';
export const MOBILE_CLIENT = 'mobile';

export const meSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string(),
    emailVerified: z.boolean(),
    roles: z.array(roleSchema),
    permissions: z.array(permissionSchema),
    mfaEnabled: z.boolean(),
    /** Nível da sessão atual: 2 quando confirmada com segundo fator (exigido em ações de Admin). */
    sessionAal: z.union([z.literal(1), z.literal(2)]),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Me' });

export const sessionTokensSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    accessTokenExpiresIn: z.number().int().describe('Segundos'),
  })
  .meta({
    id: 'SessionTokens',
    description: 'Presente apenas para clientes mobile (`x-f4d-client: mobile`).',
  });

export const authResponseSchema = z
  .object({
    status: z.literal('authenticated'),
    user: meSchema,
    session: sessionTokensSchema.optional(),
  })
  .meta({ id: 'AuthResponse' });

export const mfaChallengeResponseSchema = z
  .object({
    status: z.literal('mfa_required'),
    challengeToken: z.string(),
    expiresInSeconds: z.number().int(),
  })
  .meta({
    id: 'MfaChallengeResponse',
    description: 'Senha correta; conclua em POST /v1/auth/mfa/verify com o código do app.',
  });

export const loginResponseSchema = z
  .discriminatedUnion('status', [authResponseSchema, mfaChallengeResponseSchema])
  .meta({ id: 'LoginResponse' });

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { error: 'Informe os 6 dígitos do app.' });

export const mfaSetupResponseSchema = z
  .object({
    secret: z.string().describe('Para digitar manualmente no app, se não der para ler o QR code.'),
    otpauthUrl: z.string().describe('Conteúdo do QR code.'),
  })
  .meta({ id: 'MfaSetupResponse' });

export const mfaEnableResponseSchema = authResponseSchema
  .extend({
    recoveryCodes: z.array(z.string()).describe('Exibidos uma única vez. Guarde em local seguro.'),
  })
  .meta({ id: 'MfaEnableResponse' });

export const mfaVerifyRequestSchema = z
  .object({
    challengeToken: z.string().max(100),
    code: totpCodeSchema.optional(),
    recoveryCode: z.string().trim().max(20).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
    error: 'Informe o código do app ou um código de recuperação.',
    path: ['code'],
  });

export const registerRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(2).max(80),
    role: selfAssignableRoleSchema,
    acceptTerms: z.literal(true, {
      error: 'É preciso aceitar os termos de uso e a política de privacidade.',
    }),
  })
  .strict()
  .meta({ id: 'RegisterRequest' });

export const loginRequestSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(PASSWORD_MAX_LENGTH) })
  .strict()
  .meta({ id: 'LoginRequest' });

export const refreshRequestSchema = z
  .object({ refreshToken: z.string().max(200).optional() })
  .strict()
  .meta({ id: 'RefreshRequest', description: 'Web: corpo vazio (cookie). Mobile: refreshToken.' });

export const verifyEmailRequestSchema = z.object({ token: oneTimeTokenSchema }).strict();
export const forgotPasswordRequestSchema = z.object({ email: emailSchema }).strict();
export const resetPasswordRequestSchema = z
  .object({ token: oneTimeTokenSchema, password: passwordSchema })
  .strict();

export const oauthProviderSchema = z.enum(['github', 'google']);
export type OAuthProviderName = z.infer<typeof oauthProviderSchema>;

/** Só caminhos internos do web: impede usar o login como redirecionador aberto. */
export const internalPathSchema = z
  .string()
  .max(512)
  .regex(/^\/(?![/\\])[\w\-./?=&%#]*$/, { error: 'Destino inválido.' });

/** Códigos de erro do login social, enviados ao web em `/entrar?erro=<código>`. */
export const OAuthErrorReason = {
  Cancelled: 'oauth-cancelado',
  InvalidState: 'oauth-expirado',
  ProviderFailed: 'oauth-provedor',
  EmailNotVerified: 'oauth-email-nao-verificado',
  AccountSuspended: 'conta-suspensa',
} as const;

export type Me = z.infer<typeof meSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;
export type MfaEnableResponse = z.infer<typeof mfaEnableResponseSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;

const tags = ['auth'] as const;

export const authRoutes = {
  csrf: defineRoute({
    method: 'get',
    path: '/v1/auth/csrf',
    operationId: 'issueCsrfToken',
    summary: 'Emite o cookie CSRF (double-submit) usado pelo web em requisições mutáveis.',
    tags,
    auth: 'public',
    request: {},
    responses: { 204: noContent },
  }),
  register: defineRoute({
    method: 'post',
    path: '/v1/auth/register',
    operationId: 'register',
    summary: 'Cria a conta (cliente ou freelancer) e já inicia a sessão.',
    tags,
    auth: 'public',
    request: { body: registerRequestSchema },
    responses: { 201: authResponseSchema },
  }),
  login: defineRoute({
    method: 'post',
    path: '/v1/auth/login',
    operationId: 'login',
    summary: 'Inicia sessão com e-mail e senha.',
    tags,
    auth: 'public',
    request: { body: loginRequestSchema },
    responses: { 200: loginResponseSchema },
  }),
  refresh: defineRoute({
    method: 'post',
    path: '/v1/auth/refresh',
    operationId: 'refreshSession',
    summary: 'Renova a sessão (refresh token rotativo com detecção de reuso).',
    tags,
    auth: 'public',
    request: { body: refreshRequestSchema },
    responses: { 200: authResponseSchema },
  }),
  logout: defineRoute({
    method: 'post',
    path: '/v1/auth/logout',
    operationId: 'logout',
    summary: 'Encerra a sessão atual.',
    tags,
    auth: 'public',
    request: { body: refreshRequestSchema },
    responses: { 204: noContent },
  }),
  verifyEmail: defineRoute({
    method: 'post',
    path: '/v1/auth/email/verify',
    operationId: 'verifyEmail',
    summary: 'Confirma o e-mail com o token enviado por e-mail.',
    tags,
    auth: 'public',
    request: { body: verifyEmailRequestSchema },
    responses: { 204: noContent },
  }),
  resendVerification: defineRoute({
    method: 'post',
    path: '/v1/auth/email/resend',
    operationId: 'resendEmailVerification',
    summary: 'Reenvia o e-mail de verificação.',
    tags,
    auth: 'authenticated',
    request: {},
    responses: { 202: noContent },
  }),
  forgotPassword: defineRoute({
    method: 'post',
    path: '/v1/auth/password/forgot',
    operationId: 'forgotPassword',
    summary: 'Envia link de redefinição. Sempre responde 202 (não revela se o e-mail existe).',
    tags,
    auth: 'public',
    request: { body: forgotPasswordRequestSchema },
    responses: { 202: noContent },
  }),
  resetPassword: defineRoute({
    method: 'post',
    path: '/v1/auth/password/reset',
    operationId: 'resetPassword',
    summary: 'Redefine a senha e encerra todas as sessões abertas.',
    tags,
    auth: 'public',
    request: { body: resetPasswordRequestSchema },
    responses: { 204: noContent },
  }),
  mfaSetup: defineRoute({
    method: 'post',
    path: '/v1/auth/mfa/setup',
    operationId: 'beginMfaSetup',
    summary: 'Gera o segredo TOTP (ainda inativo) e o conteúdo do QR code.',
    tags: ['auth', 'mfa'],
    auth: 'authenticated',
    request: {},
    responses: { 200: mfaSetupResponseSchema },
  }),
  mfaEnable: defineRoute({
    method: 'post',
    path: '/v1/auth/mfa/enable',
    operationId: 'confirmMfaSetup',
    summary: 'Ativa o 2FA com um código do app; devolve códigos de recuperação e sessão nível 2.',
    tags: ['auth', 'mfa'],
    auth: 'authenticated',
    request: { body: z.object({ code: totpCodeSchema }).strict() },
    responses: { 200: mfaEnableResponseSchema },
  }),
  mfaVerify: defineRoute({
    method: 'post',
    path: '/v1/auth/mfa/verify',
    operationId: 'completeMfaLogin',
    summary: 'Conclui o login com o código do app ou um código de recuperação.',
    tags: ['auth', 'mfa'],
    auth: 'public',
    request: { body: mfaVerifyRequestSchema },
    responses: { 200: authResponseSchema },
  }),
  mfaDisable: defineRoute({
    method: 'post',
    path: '/v1/auth/mfa/disable',
    operationId: 'disableMfa',
    summary: 'Desativa o 2FA (indisponível para administradores). Exige sessão nível 2.',
    tags: ['auth', 'mfa'],
    auth: 'authenticated',
    request: { body: z.object({ code: totpCodeSchema }).strict() },
    responses: { 204: noContent },
  }),
  oauthStart: defineRoute({
    method: 'get',
    path: '/v1/auth/oauth/{provider}',
    operationId: 'startOAuth',
    summary: 'Redireciona para o provedor (GitHub/Google). Navegação de página, não fetch.',
    tags: ['auth', 'oauth'],
    auth: 'public',
    request: {
      params: z.object({ provider: oauthProviderSchema }),
      query: z.object({
        role: selfAssignableRoleSchema.optional().describe('Papel em caso de cadastro novo.'),
        redirectTo: internalPathSchema.optional(),
      }),
    },
    responses: { 302: noContent },
  }),
  oauthCallback: defineRoute({
    method: 'get',
    path: '/v1/auth/oauth/{provider}/callback',
    operationId: 'oauthCallback',
    summary: 'Retorno do provedor: abre a sessão (ou desafio de 2FA) e redireciona ao web.',
    tags: ['auth', 'oauth'],
    auth: 'public',
    request: {
      params: z.object({ provider: oauthProviderSchema }),
      query: z.object({
        code: z.string().max(2048).optional(),
        state: z.string().max(256).optional(),
        error: z.string().max(256).optional(),
      }),
    },
    responses: { 302: noContent },
  }),
  me: defineRoute({
    method: 'get',
    path: '/v1/me',
    operationId: 'getMe',
    summary: 'Usuário da sessão atual, com papéis e permissões.',
    tags: ['me'],
    auth: 'authenticated',
    request: {},
    responses: { 200: meSchema },
  }),
} as const;
