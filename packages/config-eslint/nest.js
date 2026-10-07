import globals from 'globals';
import tseslint from 'typescript-eslint';
import base from './base.js';

const FRAMEWORKS = [
  '@nestjs/*',
  'drizzle-orm',
  'drizzle-orm/*',
  'bullmq',
  'pg',
  'ioredis',
  'stripe',
  'fastify',
  'nestjs-pino',
  '@sentry/*',
];

/**
 * Fronteiras da arquitetura em camadas (docs/architecture.md §2):
 * - domain: TS puro, não conhece frameworks nem outras camadas.
 * - application: depende só de domain e de ports; também sem frameworks.
 * - infrastructure / interface: livres para usar frameworks.
 */
export default tseslint.config(
  ...base,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // Nest injeta por metadata de tipo: `import type` quebraria a DI em classes injetáveis.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['src/**/domain/**/*.ts', 'src/shared/kernel/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: FRAMEWORKS, message: 'O domínio não pode depender de frameworks.' },
            {
              group: [
                '**/application/**',
                '**/infrastructure/**',
                '**/interface/**',
                '**/shared/infra/**',
              ],
              message: 'O domínio não depende de camadas externas.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: FRAMEWORKS, message: 'Casos de uso não dependem de frameworks; use ports.' },
            {
              group: ['**/infrastructure/**', '**/interface/**', '**/shared/infra/**'],
              message: 'A aplicação depende apenas de domain e ports.',
            },
          ],
        },
      ],
    },
  },
);
