import type { Estimate } from '@f4d/contracts';
import { describe, expect, it } from 'vitest';
import { normalizeEstimate, normalizeQuestions } from './estimate-policy.js';

const catalog = {
  levels: [
    { slug: 'intermediario', name: 'Intermediário', rank: 2 },
    { slug: 'iniciante', name: 'Iniciante', rank: 1 },
  ],
  stacks: [
    { slug: 'react', name: 'React', category: 'frontend' as const },
    { slug: 'node', name: 'Node.js', category: 'backend' as const },
  ],
};

const raw: Estimate = {
  summary: '  Loja virtual  ',
  priceRange: { minCents: 1_234_567, maxCents: 456_789 },
  durationDays: { min: 40, max: 0.2 },
  features: ['Catálogo', '', 'x'.repeat(500)],
  assumptions: [],
  suggestedType: 'ECOMMERCE',
  complexity: 'MEDIUM',
  suggestedLevel: 'guru-supremo',
  suggestedStacks: ['react', 'cobol', 'react'],
  risks: [],
  reviewNotes: [],
};

describe('normalizeEstimate', () => {
  it('keeps the AI output within the catalog and coherent ranges', () => {
    const estimate = normalizeEstimate(raw, catalog);
    expect(estimate).toMatchObject({
      summary: 'Loja virtual',
      priceRange: { minCents: 460_000, maxCents: 1_230_000 },
      durationDays: { min: 1, max: 40 },
      suggestedLevel: 'iniciante',
      suggestedStacks: ['react'],
    });
    expect(estimate.features).toHaveLength(2);
    expect(estimate.features[1]).toHaveLength(300);
  });

  it('keeps a known level', () => {
    expect(
      normalizeEstimate({ ...raw, suggestedLevel: 'intermediario' }, catalog).suggestedLevel,
    ).toBe('intermediario');
  });
});

describe('normalizeQuestions', () => {
  it('assigns stable ids and caps the number of questions', () => {
    const question = {
      id: 'whatever',
      question: 'Precisa de login?',
      options: [
        { id: 'x', label: 'Sim' },
        { id: 'y', label: 'Não' },
      ],
      allowOther: true,
    };
    const normalized = normalizeQuestions([question, question, question, question]);
    expect(normalized).toHaveLength(3);
    expect(normalized[2]).toMatchObject({
      id: 'q3',
      options: [
        { id: 'a', label: 'Sim' },
        { id: 'b', label: 'Não' },
      ],
    });
  });
});
