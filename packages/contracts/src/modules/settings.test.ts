import { describe, expect, it } from 'vitest';
import { scopeInputSchema } from './projects.js';
import { SETTINGS, type SettingKey } from './settings.js';

describe('SETTINGS registry', () => {
  it('has defaults that satisfy their own schema', () => {
    for (const key of Object.keys(SETTINGS) as SettingKey[]) {
      const { schema, default: value } = SETTINGS[key];
      expect(schema.safeParse(value).success, key).toBe(true);
    }
  });
});

describe('scopeInputSchema', () => {
  it('rejects an inverted price range on the max field', () => {
    const result = scopeInputSchema.safeParse({
      type: 'SITE',
      objective: 'Site institucional da padaria com cardápio.',
      features: ['Cardápio'],
      acceptanceCriteria: ['Publicado no domínio do cliente'],
      levelSlug: 'iniciante',
      priceRange: { minCents: 500_000, maxCents: 100_000 },
      deadlineDays: 20,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['priceRange', 'maxCents']);
  });
});
