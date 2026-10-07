import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';
import base from './base.js';

export default tseslint.config(...base, ...nextVitals, {
  rules: {
    // Server Components e handlers usam funções async em props de eventos com frequência.
    '@typescript-eslint/no-misused-promises': [
      'error',
      { checksVoidReturn: { attributes: false } },
    ],
  },
});
