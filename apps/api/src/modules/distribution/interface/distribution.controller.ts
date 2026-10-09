import { Controller } from '@nestjs/common';
import {
  type AdminDistribution,
  type AdminQueueEntry,
  apiRoutes,
  type CursorPage,
  type Invitation as InvitationDto,
  type InvitationSummary,
  type MyQueueStatus,
  type ProjectProposals,
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
import {
  ManageQueue,
  ReadInvitations,
  ReadProjectProposals,
  RespondToInvitation,
  SelectProposal,
} from '../application/use-cases.js';

const routes = apiRoutes.distribution;
const keysetSchema = z.tuple([z.iso.datetime(), z.uuid()]);

const toProposals = (result: Awaited<ReturnType<ReadProjectProposals['execute']>>) => ({
  awaitingResponses: result.awaitingResponses,
  proposals: result.proposals.map((proposal) => ({
    ...proposal,
    submittedAt: proposal.submittedAt.toISOString(),
  })),
});

@Controller()
export class DistributionController {
  constructor(
    private readonly invitations: ReadInvitations,
    private readonly respond: RespondToInvitation,
    private readonly proposals: ReadProjectProposals,
    private readonly selection: SelectProposal,
  ) {}

  private async invitation(freelancerId: string, invitationId: string): Promise<InvitationDto> {
    const { invitation, project } = await this.invitations.get(freelancerId, invitationId);
    return {
      id: invitation.id,
      status: invitation.status,
      invitedAt: invitation.invitedAt.toISOString(),
      deadlineAt: invitation.deadlineAt.toISOString(),
      project,
      proposal: invitation.proposal
        ? {
            amountCents: invitation.proposal.amountCents,
            deadlineDays: invitation.proposal.deadlineDays,
            message: invitation.proposal.message,
            submittedAt: invitation.proposal.submittedAt.toISOString(),
            updatedAt: invitation.proposal.updatedAt.toISOString(),
          }
        : null,
    };
  }

  @ContractRoute(routes.listMyInvitations)
  async list(
    @ValidRequest() { query }: ContractRequest<typeof routes.listMyInvitations>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<CursorPage<InvitationSummary>> {
    const after = decodeCursor(query.cursor, keysetSchema);
    const result = await this.invitations.list({
      freelancerId: principal.userId,
      view: query.view,
      limit: query.limit,
      after: after ? { invitedAt: new Date(after[0]), id: after[1] } : null,
    });
    const last = result.items.at(-1);
    return {
      items: result.items.map((item) => ({
        ...item,
        invitedAt: item.invitedAt.toISOString(),
        deadlineAt: item.deadlineAt.toISOString(),
      })),
      nextCursor:
        result.hasMore && last ? encodeCursor([last.invitedAt.toISOString(), last.id]) : null,
    };
  }

  @ContractRoute(routes.getInvitation)
  get(
    @ValidRequest() { params }: ContractRequest<typeof routes.getInvitation>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<InvitationDto> {
    return this.invitation(principal.userId, params.invitationId);
  }

  @ContractRoute(routes.declineInvitation)
  async decline(
    @ValidRequest() { params }: ContractRequest<typeof routes.declineInvitation>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<InvitationDto> {
    await this.respond.decline(principal.userId, params.invitationId);
    return this.invitation(principal.userId, params.invitationId);
  }

  @ContractRoute(routes.submitProposal)
  async submit(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.submitProposal>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<InvitationDto> {
    await this.respond.submitProposal(principal.userId, params.invitationId, body);
    return this.invitation(principal.userId, params.invitationId);
  }

  @ContractRoute(routes.withdrawProposal)
  async withdraw(
    @ValidRequest() { params }: ContractRequest<typeof routes.withdrawProposal>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<InvitationDto> {
    await this.respond.withdraw(principal.userId, params.invitationId);
    return this.invitation(principal.userId, params.invitationId);
  }

  @ContractRoute(routes.getMyQueueStatus)
  myQueue(@CurrentPrincipal() principal: Principal): Promise<MyQueueStatus> {
    return this.invitations.myQueue(principal.userId);
  }

  @ContractRoute(routes.listProjectProposals)
  async listProposals(
    @ValidRequest() { params }: ContractRequest<typeof routes.listProjectProposals>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ProjectProposals> {
    return toProposals(await this.proposals.execute(principal.userId, params.projectId));
  }

  @ContractRoute(routes.selectProposal)
  async select(
    @ValidRequest() { params, body }: ContractRequest<typeof routes.selectProposal>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ProjectProposals> {
    await this.selection.execute(principal.userId, params.projectId, body);
    return toProposals(await this.proposals.execute(principal.userId, params.projectId));
  }
}

@Controller()
export class AdminDistributionController {
  constructor(private readonly queue: ManageQueue) {}

  @ContractRoute(routes.adminListQueue)
  async list(
    @ValidRequest() { query }: ContractRequest<typeof routes.adminListQueue>,
  ): Promise<{ items: AdminQueueEntry[] }> {
    return { items: await this.queue.list(query.levelSlug ?? null, query.state) };
  }

  @ContractRoute(routes.adminReactivateFreelancer)
  reactivate(
    @ValidRequest() { params }: ContractRequest<typeof routes.adminReactivateFreelancer>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<AdminQueueEntry> {
    return this.queue.reactivate(principal.userId, params.userId, meta);
  }

  @ContractRoute(routes.adminProjectDistribution)
  distribution(
    @ValidRequest() { params }: ContractRequest<typeof routes.adminProjectDistribution>,
  ): Promise<AdminDistribution> {
    return this.queue.distribution(params.projectId);
  }
}
