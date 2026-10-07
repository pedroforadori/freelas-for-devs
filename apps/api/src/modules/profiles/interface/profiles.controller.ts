import { Controller, Inject } from '@nestjs/common';
import {
  type AdminFreelancerDetail,
  type AdminFreelancerSummary,
  apiRoutes,
  type ClientProfile,
  type CursorPage,
  type FreelancerProfile as FreelancerProfileDto,
  type Level,
  type PublicFreelancerProfile,
  type Stack,
} from '@f4d/contracts';
import { z } from 'zod';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import {
  CurrentPrincipal,
  type Principal,
  RequestContext,
} from '../../../shared/interface/http/auth/principal.js';
import {
  type ContractRequest,
  ContractRoute,
  ValidRequest,
} from '../../../shared/interface/http/contract-route.js';
import { decodeCursor, encodeCursor } from '../../../shared/interface/http/cursor.js';
import { PROFILES_DEPS, type ProfilesDeps } from '../application/ports.js';
import {
  GetMyFreelancerProfile,
  ListFreelancersForReview,
  ManageClientProfile,
  ManagePortfolio,
  ReviewFreelancerProfile,
  SubmitFreelancerProfile,
  UpdateMyFreelancerProfile,
} from '../application/use-cases.js';
import { ProfileNotFoundError } from '../domain/errors.js';
import type { FreelancerProfile } from '../domain/freelancer-profile.js';

const routes = apiRoutes.profiles;
const reviewCursorSchema = z.tuple([z.iso.datetime().nullable(), z.uuid()]);

/** Monta as respostas de perfil a partir do agregado + catálogo + dados de identidade. */
class ProfilePresenter {
  constructor(private readonly deps: ProfilesDeps) {}

  async profile(profile: FreelancerProfile): Promise<FreelancerProfileDto> {
    const s = profile.toSnapshot();
    const [person, level] = await Promise.all([
      this.deps.people.find(s.userId),
      s.levelSlug ? this.deps.catalog.findLevel(s.levelSlug) : Promise.resolve(null),
    ]);
    return {
      userId: s.userId,
      displayName: person?.displayName ?? '',
      headline: s.headline,
      bio: s.bio,
      stacks: s.stacks,
      projectTypes: s.projectTypes,
      links: s.links,
      available: s.available,
      status: s.status,
      level,
      portfolio: s.portfolio.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        stacks: item.stacks,
        ...(item.url ? { url: item.url } : {}),
      })),
      reviewNote: s.reviewNote,
      missingForSubmission: profile.missingForSubmission(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async adminDetail(profile: FreelancerProfile): Promise<AdminFreelancerDetail> {
    const [dto, person, history] = await Promise.all([
      this.profile(profile),
      this.deps.people.find(profile.userId),
      this.deps.levelHistory.list(profile.userId),
    ]);
    return {
      ...dto,
      email: person?.email ?? '',
      levelHistory: history.map((entry) => ({
        ...entry,
        changedAt: entry.changedAt.toISOString(),
      })),
    };
  }
}

@Controller()
export class ProfilesController {
  private readonly present: ProfilePresenter;

  constructor(
    @Inject(PROFILES_DEPS) private readonly deps: ProfilesDeps,
    private readonly getMyProfile: GetMyFreelancerProfile,
    private readonly updateMyProfile: UpdateMyFreelancerProfile,
    private readonly portfolio: ManagePortfolio,
    private readonly submitProfile: SubmitFreelancerProfile,
    private readonly clientProfiles: ManageClientProfile,
  ) {
    this.present = new ProfilePresenter(deps);
  }

  @ContractRoute(apiRoutes.catalog.stacks)
  async stacks(): Promise<{ items: Stack[] }> {
    return { items: await this.deps.catalog.listStacks() };
  }

  @ContractRoute(apiRoutes.catalog.levels)
  async levels(): Promise<{ items: Level[] }> {
    return { items: await this.deps.catalog.listLevels() };
  }

  @ContractRoute(routes.getMyFreelancerProfile)
  async getMine(@CurrentPrincipal() principal: Principal): Promise<FreelancerProfileDto> {
    return this.present.profile(await this.getMyProfile.execute(principal.userId));
  }

  @ContractRoute(routes.updateMyFreelancerProfile)
  async updateMine(
    @ValidRequest() { body }: ContractRequest<typeof routes.updateMyFreelancerProfile>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<FreelancerProfileDto> {
    return this.present.profile(await this.updateMyProfile.execute(principal.userId, body));
  }

  @ContractRoute(routes.addPortfolioItem)
  async addItem(
    @ValidRequest() { body }: ContractRequest<typeof routes.addPortfolioItem>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<FreelancerProfileDto> {
    return this.present.profile(await this.portfolio.add(principal.userId, body));
  }

  @ContractRoute(routes.updatePortfolioItem)
  async updateItem(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.updatePortfolioItem>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<FreelancerProfileDto> {
    return this.present.profile(await this.portfolio.update(principal.userId, params.itemId, body));
  }

  @ContractRoute(routes.removePortfolioItem)
  async removeItem(
    @ValidRequest() { params }: ContractRequest<typeof routes.removePortfolioItem>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<FreelancerProfileDto> {
    return this.present.profile(await this.portfolio.remove(principal.userId, params.itemId));
  }

  @ContractRoute(routes.submitFreelancerProfile)
  async submit(
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<FreelancerProfileDto> {
    return this.present.profile(await this.submitProfile.execute(principal.userId, meta));
  }

  @ContractRoute(routes.getMyClientProfile)
  getClient(@CurrentPrincipal() principal: Principal): Promise<ClientProfile> {
    return this.clientProfiles.get(principal.userId);
  }

  @ContractRoute(routes.updateMyClientProfile)
  updateClient(
    @ValidRequest() { body }: ContractRequest<typeof routes.updateMyClientProfile>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ClientProfile> {
    return this.clientProfiles.update(principal.userId, body.companyName);
  }

  /** Só perfis aprovados são visíveis a terceiros; os demais respondem 404 (não revelam existência). */
  @ContractRoute(routes.getPublicFreelancerProfile)
  async getPublic(
    @ValidRequest() { params }: ContractRequest<typeof routes.getPublicFreelancerProfile>,
  ): Promise<PublicFreelancerProfile> {
    const profile = await this.deps.profiles.find(params.userId);
    if (profile?.status !== 'APPROVED') throw new ProfileNotFoundError();
    const dto = await this.present.profile(profile);
    return {
      userId: dto.userId,
      displayName: dto.displayName,
      headline: dto.headline,
      bio: dto.bio,
      stacks: dto.stacks,
      projectTypes: dto.projectTypes,
      links: dto.links,
      portfolio: dto.portfolio,
      level: dto.level,
    };
  }
}

/** Painel do Admin: análise de perfis. Todas as rotas exigem permissão administrativa + 2FA. */
@Controller()
export class AdminProfilesController {
  private readonly present: ProfilePresenter;

  constructor(
    @Inject(PROFILES_DEPS) private readonly deps: ProfilesDeps,
    private readonly review: ReviewFreelancerProfile,
    private readonly listForReview: ListFreelancersForReview,
  ) {
    this.present = new ProfilePresenter(deps);
  }

  @ContractRoute(routes.adminListFreelancers)
  async list(
    @ValidRequest() { query }: ContractRequest<typeof routes.adminListFreelancers>,
  ): Promise<CursorPage<AdminFreelancerSummary>> {
    const after = decodeCursor(query.cursor, reviewCursorSchema);
    const page = await this.listForReview.execute({
      status: query.status,
      limit: query.limit,
      after: after ? { submittedAt: after[0] ? new Date(after[0]) : null, userId: after[1] } : null,
    });
    const levels = await this.deps.catalog.listLevels();
    const last = page.items.at(-1);
    return {
      items: page.items.map((item) => ({
        userId: item.userId,
        displayName: item.displayName,
        email: item.email,
        headline: item.headline,
        status: item.status,
        level: levels.find((level) => level.slug === item.levelSlug) ?? null,
        stacks: item.stacks,
        submittedAt: item.submittedAt?.toISOString() ?? null,
      })),
      nextCursor:
        page.hasMore && last
          ? encodeCursor([last.submittedAt?.toISOString() ?? null, last.userId])
          : null,
    };
  }

  @ContractRoute(routes.adminGetFreelancer)
  async get(
    @ValidRequest() { params }: ContractRequest<typeof routes.adminGetFreelancer>,
  ): Promise<AdminFreelancerDetail> {
    const profile = await this.deps.profiles.find(params.userId);
    if (!profile) throw new ProfileNotFoundError();
    return this.present.adminDetail(profile);
  }

  @ContractRoute(routes.adminApproveFreelancer)
  async approve(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminApproveFreelancer>,
    @CurrentPrincipal() admin: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<AdminFreelancerDetail> {
    return this.present.adminDetail(
      await this.review.approve(admin.userId, params.userId, body, meta),
    );
  }

  @ContractRoute(routes.adminRequestChanges)
  async requestChanges(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminRequestChanges>,
    @CurrentPrincipal() admin: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<AdminFreelancerDetail> {
    return this.present.adminDetail(
      await this.review.requestChanges(admin.userId, params.userId, body.reason, meta),
    );
  }

  @ContractRoute(routes.adminReclassifyLevel)
  async reclassify(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.adminReclassifyLevel>,
    @CurrentPrincipal() admin: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<AdminFreelancerDetail> {
    return this.present.adminDetail(
      await this.review.reclassify(admin.userId, params.userId, body.levelSlug, body.reason, meta),
    );
  }
}
