import type { FreelancerProfileStatus, ProjectType } from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';
import { defineStateMachine } from '../../../shared/kernel/state-machine.js';
import { PortfolioItemNotFoundError, PortfolioLimitError, SameLevelError } from './errors.js';

export const LIMITS = { headlineMin: 10, bioMinToSubmit: 100, portfolioMax: 12 } as const;

export interface ProfileLinks {
  github?: string;
  linkedin?: string;
  website?: string;
}

export interface PortfolioItem {
  id: string;
  title: string;
  description: string;
  url: string | null;
  stacks: string[];
}

export interface FreelancerProfileSnapshot {
  userId: string;
  headline: string;
  bio: string;
  stacks: string[];
  projectTypes: ProjectType[];
  links: ProfileLinks;
  available: boolean;
  status: FreelancerProfileStatus;
  levelSlug: string | null;
  reviewNote: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  portfolio: PortfolioItem[];
  updatedAt: Date;
  version: number;
}

type ProfileEvent = 'submit' | 'approve' | 'requestChanges' | 'reclassify';

/** Ciclo de vida do perfil (docs/architecture.md §4). Enviar exige perfil completo. */
export const freelancerProfileMachine = defineStateMachine<
  FreelancerProfileStatus,
  ProfileEvent,
  { missing: string[] }
>({
  name: 'FreelancerProfile',
  initial: 'DRAFT',
  terminal: [],
  transitions: {
    DRAFT: {
      submit: {
        target: 'PENDING_REVIEW',
        guard: ({ missing }) => missing.length === 0 || `Perfil incompleto: ${missing.join('; ')}.`,
      },
    },
    CHANGES_REQUESTED: {
      submit: {
        target: 'PENDING_REVIEW',
        guard: ({ missing }) => missing.length === 0 || `Perfil incompleto: ${missing.join('; ')}.`,
      },
    },
    PENDING_REVIEW: { approve: 'APPROVED', requestChanges: 'CHANGES_REQUESTED' },
    APPROVED: { reclassify: 'APPROVED' },
  },
});

export const ProfileEvents = {
  Submitted: 'profiles.FreelancerProfileSubmitted',
  Approved: 'profiles.FreelancerProfileApproved',
  ChangesRequested: 'profiles.FreelancerProfileChangesRequested',
  LevelChanged: 'profiles.FreelancerLevelChanged',
} as const;

export interface LevelChange {
  from: string | null;
  to: string;
}

export class FreelancerProfile extends AggregateRoot {
  protected readonly aggregateType = 'FreelancerProfile';

  private constructor(
    private props: Omit<FreelancerProfileSnapshot, 'userId' | 'version'>,
    userId: string,
    version: number,
  ) {
    super(userId, version);
  }

  static createDraft(userId: string, now: Date): FreelancerProfile {
    return new FreelancerProfile(
      {
        headline: '',
        bio: '',
        stacks: [],
        projectTypes: [],
        links: {},
        available: true,
        status: 'DRAFT',
        levelSlug: null,
        reviewNote: null,
        submittedAt: null,
        reviewedAt: null,
        reviewedBy: null,
        portfolio: [],
        updatedAt: now,
      },
      userId,
      0,
    );
  }

  static rehydrate(snapshot: FreelancerProfileSnapshot): FreelancerProfile {
    const { userId, version, ...props } = snapshot;
    return new FreelancerProfile(structuredClone(props), userId, version);
  }

  get userId(): string {
    return this.id;
  }
  get status(): FreelancerProfileStatus {
    return this.props.status;
  }
  get levelSlug(): string | null {
    return this.props.levelSlug;
  }

  /** O que falta para poder enviar à análise (texto para o freelancer). */
  missingForSubmission(): string[] {
    const p = this.props;
    const missing: string[] = [];
    if (p.headline.length < LIMITS.headlineMin) missing.push('título com ao menos 10 caracteres');
    if (p.bio.length < LIMITS.bioMinToSubmit)
      missing.push('apresentação com ao menos 100 caracteres');
    if (p.stacks.length === 0) missing.push('ao menos uma stack');
    if (p.projectTypes.length === 0) missing.push('ao menos um tipo de projeto');
    if (p.portfolio.length === 0 && !p.links.github && !p.links.website) {
      missing.push('um item de portfólio ou link do GitHub/site');
    }
    return missing;
  }

  update(
    input: Pick<
      FreelancerProfileSnapshot,
      'headline' | 'bio' | 'stacks' | 'projectTypes' | 'links' | 'available'
    >,
    now: Date,
  ): void {
    Object.assign(this.props, {
      headline: input.headline.trim(),
      bio: input.bio.trim(),
      stacks: [...new Set(input.stacks)],
      projectTypes: [...new Set(input.projectTypes)],
      links: { ...input.links },
      available: input.available,
      updatedAt: now,
    });
  }

  addPortfolioItem(item: PortfolioItem, now: Date): void {
    if (this.props.portfolio.length >= LIMITS.portfolioMax)
      throw new PortfolioLimitError(LIMITS.portfolioMax);
    this.props.portfolio.push({ ...item, stacks: [...new Set(item.stacks)] });
    this.props.updatedAt = now;
  }

  updatePortfolioItem(item: PortfolioItem, now: Date): void {
    const index = this.props.portfolio.findIndex((existing) => existing.id === item.id);
    if (index < 0) throw new PortfolioItemNotFoundError();
    this.props.portfolio[index] = { ...item, stacks: [...new Set(item.stacks)] };
    this.props.updatedAt = now;
  }

  removePortfolioItem(itemId: string, now: Date): void {
    const before = this.props.portfolio.length;
    this.props.portfolio = this.props.portfolio.filter((item) => item.id !== itemId);
    if (this.props.portfolio.length === before) throw new PortfolioItemNotFoundError();
    this.props.updatedAt = now;
  }

  submit(now: Date): void {
    this.transition('submit');
    this.props.submittedAt = now;
    this.props.reviewNote = null;
    this.props.updatedAt = now;
    this.record(ProfileEvents.Submitted, now, { userId: this.id });
  }

  approve(input: {
    levelSlug: string;
    reviewerId: string;
    note: string | null;
    now: Date;
  }): LevelChange {
    this.transition('approve');
    const change = { from: this.props.levelSlug, to: input.levelSlug };
    Object.assign(this.props, {
      levelSlug: input.levelSlug,
      reviewNote: input.note,
      reviewedAt: input.now,
      reviewedBy: input.reviewerId,
      updatedAt: input.now,
    });
    this.record(ProfileEvents.Approved, input.now, { userId: this.id, level: input.levelSlug });
    return change;
  }

  requestChanges(input: { reason: string; reviewerId: string; now: Date }): void {
    this.transition('requestChanges');
    Object.assign(this.props, {
      reviewNote: input.reason,
      reviewedAt: input.now,
      reviewedBy: input.reviewerId,
      updatedAt: input.now,
    });
    this.record(ProfileEvents.ChangesRequested, input.now, { userId: this.id });
  }

  reclassify(levelSlug: string, now: Date): LevelChange {
    this.transition('reclassify');
    if (levelSlug === this.props.levelSlug) throw new SameLevelError();
    const change = { from: this.props.levelSlug, to: levelSlug };
    this.props.levelSlug = levelSlug;
    this.props.updatedAt = now;
    this.record(ProfileEvents.LevelChanged, now, { userId: this.id, ...change });
    return change;
  }

  toSnapshot(): FreelancerProfileSnapshot {
    return { ...structuredClone(this.props), userId: this.id, version: this.version };
  }

  private transition(event: ProfileEvent): void {
    const result = freelancerProfileMachine.transition(this.props.status, event, {
      missing: this.missingForSubmission(),
    });
    if (!result.ok) throw result.error;
    this.props.status = result.value;
  }
}
