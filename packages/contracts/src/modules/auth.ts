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
  .object({ user: meSchema, session: sessionTokensSchema.optional() })
  .meta({ id: 'AuthResponse' });

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

export type Me = z.infer<typeof meSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
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
    responses: { 200: authResponseSchema },
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
