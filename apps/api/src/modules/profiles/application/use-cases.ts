import type {
  FreelancerProfileInput,
  FreelancerProfileStatus,
  PortfolioItemInput,
} from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { ProfileNotFoundError, UnknownCatalogEntryError } from '../domain/errors.js';
import { FreelancerProfile, type LevelChange } from '../domain/freelancer-profile.js';
import { levelChangedEmail, profileApprovedEmail, profileChangesRequestedEmail } from './emails.js';
import type { ProfilesDeps, ReviewQueueItem } from './ports.js';

export abstract class ProfilesUseCase {
  constructor(protected readonly deps: ProfilesDeps) {}

  protected async loadOrCreate(userId: string): Promise<FreelancerProfile> {
    return (
      (await this.deps.profiles.find(userId)) ??
      FreelancerProfile.createDraft(userId, this.deps.clock.now())
    );
  }

  protected async load(userId: string): Promise<FreelancerProfile> {
    const profile = await this.deps.profiles.find(userId);
    if (!profile) throw new ProfileNotFoundError();
    return profile;
  }

  protected async assertKnownStacks(slugs: readonly string[]): Promise<void> {
    const unknown = await this.deps.catalog.unknownStacks(slugs);
    if (unknown.length > 0) throw new UnknownCatalogEntryError('stack', unknown);
  }

  protected async notify(
    userId: string,
    build: (to: string, name: string) => Parameters<ProfilesDeps['mailer']['send']>[0],
  ) {
    const person = await this.deps.people.find(userId);
    if (person)
      await this.deps.mailer.send(build(person.email, person.displayName)).catch(() => undefined);
  }

  protected get profileUrl(): string {
    return `${this.deps.webAppUrl}/perfil`;
  }
}

/** Abre o perfil do freelancer, criando o rascunho no primeiro acesso. */
export class GetMyFreelancerProfile extends ProfilesUseCase {
  async execute(userId: string): Promise<FreelancerProfile> {
    const existing = await this.deps.profiles.find(userId);
    if (existing) return existing;
    const draft = FreelancerProfile.createDraft(userId, this.deps.clock.now());
    await this.deps.profiles.save(draft);
    return draft;
  }
}

export class UpdateMyFreelancerProfile extends ProfilesUseCase {
  async execute(userId: string, input: FreelancerProfileInput): Promise<FreelancerProfile> {
    await this.assertKnownStacks(input.stacks);
    return this.deps.uow.run(async () => {
      const profile = await this.loadOrCreate(userId);
      profile.update(input, this.deps.clock.now());
      await this.deps.profiles.save(profile);
      return profile;
    });
  }
}

const toItem = (id: string, input: PortfolioItemInput) => ({
  id,
  title: input.title,
  description: input.description,
  url: input.url ?? null,
  stacks: input.stacks,
});

export class ManagePortfolio extends ProfilesUseCase {
  async add(userId: string, input: PortfolioItemInput): Promise<FreelancerProfile> {
    await this.assertKnownStacks(input.stacks);
    return this.mutate(userId, (profile, now) =>
      profile.addPortfolioItem(toItem(this.deps.ids.next(), input), now),
    );
  }

  async update(
    userId: string,
    itemId: string,
    input: PortfolioItemInput,
  ): Promise<FreelancerProfile> {
    await this.assertKnownStacks(input.stacks);
    return this.mutate(userId, (profile, now) =>
      profile.updatePortfolioItem(toItem(itemId, input), now),
    );
  }

  remove(userId: string, itemId: string): Promise<FreelancerProfile> {
    return this.mutate(userId, (profile, now) => profile.removePortfolioItem(itemId, now));
  }

  private mutate(userId: string, change: (profile: FreelancerProfile, now: Date) => void) {
    return this.deps.uow.run(async () => {
      const profile = await this.loadOrCreate(userId);
      change(profile, this.deps.clock.now());
      await this.deps.profiles.save(profile);
      return profile;
    });
  }
}

export class SubmitFreelancerProfile extends ProfilesUseCase {
  async execute(userId: string, meta: RequestMeta): Promise<FreelancerProfile> {
    return this.deps.uow.run(async () => {
      const profile = await this.load(userId);
      profile.submit(this.deps.clock.now());
      await this.deps.profiles.save(profile);
      await this.deps.audit.record({
        actorId: userId,
        action: 'profiles.freelancer_submitted',
        targetType: 'freelancer_profile',
        targetId: userId,
        request: meta,
      });
      return profile;
    });
  }
}

/** Decisões do Admin sobre perfis de freelancer — todas auditadas e notificadas por e-mail. */
export class ReviewFreelancerProfile extends ProfilesUseCase {
  async approve(
    adminId: string,
    userId: string,
    input: { levelSlug?: string | undefined; note?: string | undefined },
    meta: RequestMeta,
  ): Promise<FreelancerProfile> {
    const level = input.levelSlug
      ? await this.deps.catalog.findLevel(input.levelSlug)
      : await this.deps.catalog.initialLevel();
    if (!level) throw new UnknownCatalogEntryError('nível', [input.levelSlug ?? '']);

    const profile = await this.deps.uow.run(async () => {
      const loaded = await this.load(userId);
      const change = loaded.approve({
        levelSlug: level.slug,
        reviewerId: adminId,
        note: input.note ?? null,
        now: this.deps.clock.now(),
      });
      await this.deps.profiles.save(loaded);
      await this.recordLevelChange(userId, change, 'Aprovação do perfil', adminId);
      await this.audit(adminId, userId, 'admin.freelancer_approved', { level: level.slug }, meta);
      return loaded;
    });
    await this.notify(userId, (to, name) =>
      profileApprovedEmail(to, name, level.name, this.profileUrl),
    );
    return profile;
  }

  async requestChanges(
    adminId: string,
    userId: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<FreelancerProfile> {
    const profile = await this.deps.uow.run(async () => {
      const loaded = await this.load(userId);
      loaded.requestChanges({ reason, reviewerId: adminId, now: this.deps.clock.now() });
      await this.deps.profiles.save(loaded);
      await this.audit(adminId, userId, 'admin.freelancer_changes_requested', {}, meta);
      return loaded;
    });
    await this.notify(userId, (to, name) =>
      profileChangesRequestedEmail(to, name, reason, this.profileUrl),
    );
    return profile;
  }

  /** Reclassificação manual (ex.: após análise de portfólio/GitHub), com motivo obrigatório. */
  async reclassify(
    adminId: string,
    userId: string,
    levelSlug: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<FreelancerProfile> {
    const level = await this.deps.catalog.findLevel(levelSlug);
    if (!level) throw new UnknownCatalogEntryError('nível', [levelSlug]);

    const profile = await this.deps.uow.run(async () => {
      const loaded = await this.load(userId);
      const change = loaded.reclassify(level.slug, this.deps.clock.now());
      await this.deps.profiles.save(loaded);
      await this.recordLevelChange(userId, change, reason, adminId);
      await this.audit(
        adminId,
        userId,
        'admin.freelancer_reclassified',
        { ...change, reason },
        meta,
      );
      return loaded;
    });
    await this.notify(userId, (to, name) =>
      levelChangedEmail(to, name, level.name, this.profileUrl),
    );
    return profile;
  }

  private recordLevelChange(
    userId: string,
    change: LevelChange,
    reason: string,
    changedBy: string,
  ) {
    return this.deps.levelHistory.record({
      id: this.deps.ids.next(),
      userId,
      ...change,
      reason,
      changedBy,
    });
  }

  private audit(
    adminId: string,
    userId: string,
    action: string,
    metadata: Record<string, unknown>,
    meta: RequestMeta,
  ) {
    return this.deps.audit.record({
      actorId: adminId,
      action,
      targetType: 'freelancer_profile',
      targetId: userId,
      metadata,
      request: meta,
    });
  }
}

export interface ReviewQueuePage {
  items: ReviewQueueItem[];
  hasMore: boolean;
}

export class ListFreelancersForReview extends ProfilesUseCase {
  async execute(input: {
    status: FreelancerProfileStatus;
    limit: number;
    after: { submittedAt: Date | null; userId: string } | null;
  }): Promise<ReviewQueuePage> {
    const items = await this.deps.reviewQueue.list({ ...input, limit: input.limit + 1 });
    return { items: items.slice(0, input.limit), hasMore: items.length > input.limit };
  }
}

export class ManageClientProfile extends ProfilesUseCase {
  async get(userId: string) {
    return (await this.deps.clients.find(userId)) ?? { userId, companyName: null };
  }

  async update(userId: string, companyName: string | null) {
    const profile = { userId, companyName: companyName?.trim() || null };
    await this.deps.clients.upsert(profile);
    return profile;
  }
}
