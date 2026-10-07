/**
 * Gera um par Ed25519 para assinar access tokens e imprime as linhas de .env.
 * Uso: pnpm --filter @f4d/api keys:generate >> .env
 *
 * Rotação: gere um novo par com outro JWT_KEY_ID e mova a chave pública antiga para
 * JWT_PREVIOUS_PUBLIC_KEYS até expirarem os tokens emitidos com ela (15 min).
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n');
const keyId = `k${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

process.stdout.write(
  [
    `JWT_KEY_ID=${keyId}`,
    `JWT_PRIVATE_KEY="${oneLine(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())}"`,
    `# Pública (para JWT_PREVIOUS_PUBLIC_KEYS numa rotação futura):`,
    `# ${oneLine(publicKey.export({ type: 'spki', format: 'pem' }).toString())}`,
    '',
  ].join('\n'),
);
