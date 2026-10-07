import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../../../shared/kernel/domain-error.js';
import { PortfolioLimitError, SameLevelError } from './errors.js';
import {
  FreelancerProfile,
  freelancerProfileMachine,
  ProfileEvents,
} from './freelancer-profile.js';

const now = new Date('2026-03-01T12:00:00Z');

const complete = () => {
  const profile = FreelancerProfile.createDraft('u1', now);
  profile.update(
    {
      headline: 'Dev front-end React',
      bio: 'Desenvolvo interfaces acessíveis e rápidas com React e Next.js. '.repeat(3),
      stacks: ['react', 'react', 'nextjs'],
      projectTypes: ['SITE'],
      links: { github: 'https://github.com/dev' },
      available: true,
    },
    now,
  );
  return profile;
};

const approve = (profile: FreelancerProfile) =>
  profile.approve({ levelSlug: 'iniciante', reviewerId: 'admin', note: null, now });

describe('FreelancerProfile', () => {
  it('lists what is missing before it can be submitted', () => {
    const draft = FreelancerProfile.createDraft('u1', now);
    expect(draft.missingForSubmission()).toHaveLength(5);
    expect(() => draft.submit(now)).toThrow(InvalidStateTransitionError);
    expect(complete().missingForSubmission()).toEqual([]);
  });

  it('deduplicates stacks and accepts a portfolio item instead of links', () => {
    const profile = complete();
    expect(profile.toSnapshot().stacks).toEqual(['react', 'nextjs']);

    profile.update({ ...profile.toSnapshot(), links: {} }, now);
    expect(profile.missingForSubmission()).toEqual(['um item de portfólio ou link do GitHub/site']);
    profile.addPortfolioItem(
      {
        id: 'p1',
        title: 'Loja',
        description: 'Loja virtual completa em Next.js',
        url: null,
        stacks: [],
      },
      now,
    );
    expect(profile.missingForSubmission()).toEqual([]);
  });

  it('goes through review: submit → changes requested → resubmit → approved', () => {
    const profile = complete();
    profile.submit(now);
    profile.requestChanges({
      reason: 'Adicione um projeto real ao portfólio.',
      reviewerId: 'admin',
      now,
    });
    expect(profile.toSnapshot()).toMatchObject({
      status: 'CHANGES_REQUESTED',
      reviewNote: expect.any(String),
    });

    profile.submit(now);
    expect(profile.toSnapshot().reviewNote).toBeNull();
    expect(approve(profile)).toEqual({ from: null, to: 'iniciante' });
    expect(profile.status).toBe('APPROVED');
    expect(profile.pullEvents().map((e) => e.type)).toEqual([
      ProfileEvents.Submitted,
      ProfileEvents.ChangesRequested,
      ProfileEvents.Submitted,
      ProfileEvents.Approved,
    ]);
  });

  it('only reclassifies approved profiles, to a different level', () => {
    const profile = complete();
    expect(() => profile.reclassify('avancado', now)).toThrow(InvalidStateTransitionError);
    profile.submit(now);
    approve(profile);
    expect(profile.reclassify('avancado', now)).toEqual({ from: 'iniciante', to: 'avancado' });
    expect(() => profile.reclassify('avancado', now)).toThrow(SameLevelError);
  });

  it('caps the portfolio', () => {
    const profile = complete();
    for (let i = 0; i < 12; i += 1) {
      profile.addPortfolioItem(
        { id: `p${i}`, title: 't', description: 'd', url: null, stacks: [] },
        now,
      );
    }
    expect(() =>
      profile.addPortfolioItem(
        { id: 'extra', title: 't', description: 'd', url: null, stacks: [] },
        now,
      ),
    ).toThrow(PortfolioLimitError);
  });

  it('documents its lifecycle as a Mermaid diagram', () => {
    expect(freelancerProfileMachine.toMermaid()).toBe(
      [
        'stateDiagram-v2',
        '  [*] --> DRAFT',
        '  DRAFT --> PENDING_REVIEW: submit',
        '  CHANGES_REQUESTED --> PENDING_REVIEW: submit',
        '  PENDING_REVIEW --> APPROVED: approve',
        '  PENDING_REVIEW --> CHANGES_REQUESTED: requestChanges',
        '  APPROVED --> APPROVED: reclassify',
      ].join('\n'),
    );
  });
});
