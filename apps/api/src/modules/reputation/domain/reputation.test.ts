import { describe, expect, it } from 'vitest';
import { computeScore, evaluatePromotion, type RawStats } from './reputation.js';

const empty: RawStats = {
  completedContracts: 0,
  startedContracts: 0,
  ratingCount: 0,
  ratingSum: 0,
  onTimeContracts: 0,
  abandonments: 0,
  invitationsAnswered: 0,
  invitationsExpired: 0,
};

const rule = {
  minCompleted: 3,
  minRatingAvg: 4,
  minOnTimeRate: 0.7,
  minScore: 0.55,
  maxAbandonments: 0,
  automatic: true,
};

describe('computeScore', () => {
  it('is neutral without history, so beginners are not penalized', () => {
    expect(computeScore(empty)).toEqual({
      score: 0.5,
      components: { rating: 0.5, onTime: 0.5, reliability: 0.5, responsiveness: 0.5 },
    });
  });

  it('rewards good work gradually and punishes abandonment and silence', () => {
    const good = computeScore({
      ...empty,
      completedContracts: 3,
      startedContracts: 3,
      ratingCount: 3,
      ratingSum: 15,
      onTimeContracts: 3,
      invitationsAnswered: 5,
    });
    expect(good.score).toBeGreaterThan(0.7);
    // Uma nota 5 isolada mexe menos que três.
    const single = computeScore({ ...empty, ratingCount: 1, ratingSum: 5 });
    expect(single.components.rating).toBeLessThan(good.components.rating);

    const bad = computeScore({
      ...empty,
      startedContracts: 2,
      abandonments: 2,
      invitationsExpired: 6,
    });
    expect(bad.score).toBeLessThan(0.45);
  });
});

describe('evaluatePromotion', () => {
  it('needs every criterion, including real ratings', () => {
    const raw: RawStats = {
      ...empty,
      completedContracts: 3,
      startedContracts: 3,
      ratingCount: 3,
      ratingSum: 13,
      onTimeContracts: 3,
      invitationsAnswered: 3,
    };
    const { score } = computeScore(raw);
    expect(evaluatePromotion(raw, score, rule).eligible).toBe(true);

    const noRatings = { ...raw, ratingCount: 0, ratingSum: 0 };
    const result = evaluatePromotion(noRatings, computeScore(noRatings).score, rule);
    expect(result.eligible).toBe(false);
    expect(result.criteria.find((c) => c.criterion === 'RATING')).toMatchObject({
      current: null,
      met: false,
    });

    const abandoned = { ...raw, startedContracts: 4, abandonments: 1 };
    expect(evaluatePromotion(abandoned, 0.9, rule).eligible).toBe(false);
  });
});
