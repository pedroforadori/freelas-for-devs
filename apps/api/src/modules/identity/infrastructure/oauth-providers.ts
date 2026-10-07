import { decodeIdToken, GitHub, Google } from 'arctic';
import { z } from 'zod';
import type { OAuthProfile, OAuthProvider } from '../application/ports.js';

const githubUserSchema = z.object({
  id: z.number(),
  login: z.string(),
  name: z.string().nullable(),
});
const githubEmailsSchema = z.array(
  z.object({ email: z.string(), primary: z.boolean(), verified: z.boolean() }),
);

/** Usa só o e-mail primário e verificado; nada além de id, nome e e-mail (minimização — LGPD). */
export const mapGitHubProfile = (user: unknown, emails: unknown): OAuthProfile => {
  const parsedUser = githubUserSchema.parse(user);
  const primary = githubEmailsSchema.parse(emails).find((entry) => entry.primary);
  return {
    provider: 'github',
    providerUserId: String(parsedUser.id),
    email: (primary?.email ?? '').toLowerCase(),
    emailVerified: primary?.verified === true,
    displayName: parsedUser.name?.trim() || parsedUser.login,
  };
};

const googleClaimsSchema = z.object({
  iss: z.enum(['https://accounts.google.com', 'accounts.google.com']),
  aud: z.string(),
  sub: z.string(),
  email: z.string(),
  email_verified: z.boolean(),
  name: z.string().optional(),
});

/**
 * O id_token chega direto do endpoint de token do Google via TLS (fluxo de código), então a
 * assinatura pode ser dispensada (OIDC Core §3.1.3.7) — mas emissor e audiência são conferidos.
 */
export const mapGoogleClaims = (claims: unknown, clientId: string): OAuthProfile => {
  const parsed = googleClaimsSchema.parse(claims);
  if (parsed.aud !== clientId) throw new Error('id_token emitido para outra aplicação.');
  return {
    provider: 'google',
    providerUserId: parsed.sub,
    email: parsed.email.toLowerCase(),
    emailVerified: parsed.email_verified,
    displayName: parsed.name?.trim() || parsed.email.split('@')[0] || 'Usuário',
  };
};

export class GitHubOAuthProvider implements OAuthProvider {
  readonly name = 'github' as const;
  private readonly client: GitHub;

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.client = new GitHub(clientId, clientSecret, redirectUri);
  }

  authorizationUrl(state: string): URL {
    return this.client.createAuthorizationURL(state, ['read:user', 'user:email']);
  }

  async fetchProfile(code: string): Promise<OAuthProfile> {
    const tokens = await this.client.validateAuthorizationCode(code);
    const headers = {
      authorization: `Bearer ${tokens.accessToken()}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'freelas-4-devs',
    };
    const [user, emails] = await Promise.all(
      ['https://api.github.com/user', 'https://api.github.com/user/emails'].map(async (url) => {
        const response = await this.fetchImpl(url, {
          headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`GitHub respondeu ${response.status} em ${url}`);
        return response.json();
      }),
    );
    return mapGitHubProfile(user, emails);
  }
}

export class GoogleOAuthProvider implements OAuthProvider {
  readonly name = 'google' as const;
  private readonly client: Google;

  constructor(
    private readonly clientId: string,
    clientSecret: string,
    redirectUri: string,
  ) {
    this.client = new Google(clientId, clientSecret, redirectUri);
  }

  authorizationUrl(state: string, codeVerifier: string): URL {
    return this.client.createAuthorizationURL(state, codeVerifier, ['openid', 'email', 'profile']);
  }

  async fetchProfile(code: string, codeVerifier: string): Promise<OAuthProfile> {
    const tokens = await this.client.validateAuthorizationCode(code, codeVerifier);
    return mapGoogleClaims(decodeIdToken(tokens.idToken()), this.clientId);
  }
}

export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');
export type OAuthProviderRegistry = ReadonlyMap<string, OAuthProvider>;
