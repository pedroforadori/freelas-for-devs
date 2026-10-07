import { describe, expect, it } from 'vitest';
import { mapGitHubProfile, mapGoogleClaims } from './oauth-providers.js';

describe('mapGitHubProfile', () => {
  it('uses the primary e-mail and its verification status', () => {
    const profile = mapGitHubProfile({ id: 42, login: 'octo', name: null }, [
      { email: 'old@exemplo.com', primary: false, verified: true },
      { email: 'Octo@Exemplo.com', primary: true, verified: false },
    ]);
    expect(profile).toEqual({
      provider: 'github',
      providerUserId: '42',
      email: 'octo@exemplo.com',
      emailVerified: false,
      displayName: 'octo',
    });
  });
});

describe('mapGoogleClaims', () => {
  const claims = {
    iss: 'https://accounts.google.com',
    aud: 'client-123',
    sub: '1098',
    email: 'Ana@Gmail.com',
    email_verified: true,
    name: 'Ana Lima',
  };

  it('maps the OIDC claims', () => {
    expect(mapGoogleClaims(claims, 'client-123')).toMatchObject({
      providerUserId: '1098',
      email: 'ana@gmail.com',
      emailVerified: true,
      displayName: 'Ana Lima',
    });
  });

  it('rejects tokens issued to another client or by another issuer', () => {
    expect(() => mapGoogleClaims(claims, 'outro-client')).toThrow('outra aplicação');
    expect(() =>
      mapGoogleClaims({ ...claims, iss: 'https://evil.example' }, 'client-123'),
    ).toThrow();
  });
});
