import type { ProposalInput, QueueState, SelectProposalRequest } from '@f4d/contracts';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { NotFoundError } from '../../../shared/kernel/domain-error.js';
import { InvitationNotFoundError, RoundNotFoundError } from '../domain/errors.js';
import { QueueEntry } from '../domain/queue-entry.js';
import { DistributionRound, type QueueEffect } from '../domain/round.js';
import { invitationEmail, newProposalEmail, selectedEmail } from './emails.js';
import { type DistributionDeps, type ProjectForDistribution, toClientScope } from './ports.js';

/** Avisos enviados depois do commit (e-mail nunca participa da transação). */
type Notice =
  | { kind: 'invited'; projectId: string; freelancerIds: string[]; hours: number }
  | { kind: 'proposal'; projectId: string; clientId: string }
  | { kind: 'selected'; projectId: string; freelancerId: string };

abstract class DistributionUseCase {
  constructor(protected readonly deps: DistributionDeps) {}

  /**
   * Repõe as vagas da rodada com os próximos da fila. Sem convites ativos, sem propostas e sem
   * candidatos, a rodada se esgota e o projeto volta para o especialista.
   */
  protected async fill(round: DistributionRound, notices: Notice[]): Promise<void> {
    if (round.status !== 'OPEN') return;
    const { queue, clock, ids } = this.deps;
    const now = clock.now();
    const slots = round.openSlots();
    if (slots > 0) {
      await queue.lockLevel(round.levelSlug);
      const freelancerIds = await queue.nextCandidates({
        projectId: round.projectId,
        levelSlug: round.levelSlug,
        projectType: round.projectType,
        requiredStacks: round.requiredStacks,
        clientId: round.clientId,
        maxOpenInvitations: round.params.maxOpenInvitesPerFreelancer,
        limit: slots,
      });
      if (freelancerIds.length > 0) {
        round.invite(
          freelancerIds.map((freelancerId) => ({ id: ids.next(), freelancerId })),
          now,
        );
        for (const entry of await queue.findMany(freelancerIds)) {
          entry.invited(now);
          await queue.save(entry);
        }
        notices.push({
          kind: 'invited',
          projectId: round.projectId,
          freelancerIds,
          hours: round.params.inviteResponseHours,
        });
      }
    }
    if (!round.hasActiveInvitations() && !round.hasProposals()) {
      round.markExhausted(now);
      await this.deps.projects.exhaustCandidates(round.projectId);
    }
  }

  /** Aplica na fila o resultado de cada decisão (perder a vez, prioridade, contratação...). */
  protected async applyEffects(round: DistributionRound, effects: QueueEffect[]): Promise<void> {
    if (effects.length === 0) return;
    const now = this.deps.clock.now();
    const entries = new Map(
      (await this.deps.queue.findMany(effects.map((effect) => effect.freelancerId))).map(
        (entry) => [entry.userId, entry],
      ),
    );
    for (const effect of effects) {
      const entry = entries.get(effect.freelancerId);
      if (!entry) continue;
      switch (effect.kind) {
        case 'lostTurn':
          entry.lostTurn(effect.reason, now);
          break;
        case 'answered':
          entry.answered(now);
          break;
        case 'voided':
          entry.voided(effect.wasAwaitingResponse, now);
          break;
        case 'hired':
          entry.hired(now);
          break;
        case 'notSelected':
          entry.notSelected(round.params.roundsBeforeMonitoring, now);
          break;
        case 'compensate':
          entry.compensate(now);
          break;
      }
    }
    for (const entry of entries.values()) await this.deps.queue.save(entry);
  }

  protected async notify(notices: Notice[]): Promise<void> {
    for (const notice of notices) {
      const project = await this.deps.projects.find(notice.projectId);
      if (!project) continue;
      const base = this.deps.webAppUrl;
      if (notice.kind === 'invited') {
        for (const freelancerId of notice.freelancerIds) {
          await this.send(freelancerId, (to, name) =>
            invitationEmail(to, name, project.title, notice.hours, `${base}/convites`),
          );
        }
      } else if (notice.kind === 'proposal') {
        await this.send(notice.clientId, (to, name) =>
          newProposalEmail(to, name, project.title, `${base}/projetos/${project.id}`),
        );
      } else {
        await this.send(notice.freelancerId, (to, name) =>
          selectedEmail(to, name, project.title, `${base}/convites`),
        );
      }
    }
  }

  private async send(
    userId: string,
    build: (to: string, name: string) => Parameters<DistributionDeps['mailer']['send']>[0],
  ): Promise<void> {
    const person = await this.deps.people.find(userId);
    if (person)
      await this.deps.mailer.send(build(person.email, person.displayName)).catch(() => undefined);
  }

  protected async roundOfInvitation(invitationId: string): Promise<DistributionRound> {
    const round = await this.deps.rounds.findByInvitation(invitationId);
    if (!round) throw new InvitationNotFoundError();
    return round;
  }

  protected async ownedProject(
    clientId: string,
    projectId: string,
  ): Promise<ProjectForDistribution> {
    const project = await this.deps.projects.find(projectId);
    if (!project || project.clientId !== clientId) throw new NotFoundError('Projeto', projectId);
    return project;
  }
}

/** Freelancer aprovado entra na fila do seu nível; reclassificação muda o nível da fila. */
export class SyncQueueEntry extends DistributionUseCase {
  execute(userId: string, levelSlug: string): Promise<void> {
    return this.deps.uow.run(async () => {
      const now = this.deps.clock.now();
      const existing = await this.deps.queue.find(userId);
      if (existing) existing.changeLevel(levelSlug, now);
      await this.deps.queue.save(existing ?? QueueEntry.create(userId, levelSlug, now));
    });
  }
}

/**
 * Escopo aprovado → abre a rodada com os parâmetros vigentes (snapshot) e convida os primeiros da
 * fila. Idempotente: evento repetido ou projeto que já saiu de READY_FOR_QUEUE não abre outra.
 */
export class OpenRound extends DistributionUseCase {
  async execute(projectId: string): Promise<DistributionRound | null> {
    const notices: Notice[] = [];
    const round = await this.deps.uow.run(async () => {
      const project = await this.deps.projects.find(projectId);
      if (project?.status !== 'READY_FOR_QUEUE' || !project.scope) return null;
      if (await this.deps.rounds.findActiveByProject(projectId)) return null;

      const { settings, clock, ids } = this.deps;
      const roundSize = await settings.get('queue.roundSize');
      const round = DistributionRound.open({
        id: ids.next(),
        projectId,
        clientId: project.clientId,
        levelSlug: project.scope.levelSlug,
        projectType: project.scope.type,
        requiredStacks: project.scope.requiredStacks,
        openedAt: clock.now(),
        params: {
          roundSize,
          maxInvites: Math.max(roundSize, await settings.get('queue.maxInvitesPerRound')),
          inviteResponseHours: await settings.get('queue.inviteResponseHours'),
          maxOpenInvitesPerFreelancer: await settings.get('queue.maxOpenInvitesPerFreelancer'),
          roundsBeforeMonitoring: await settings.get('queue.roundsBeforeMonitoring'),
          priceMinCents: project.scope.priceRange.minCents,
          priceMaxCents: project.scope.priceRange.maxCents,
          maxDeadlineDays: project.scope.deadlineDays,
        },
      });
      await this.deps.projects.startDistribution(projectId);
      await this.fill(round, notices);
      await this.deps.rounds.save(round);
      return round;
    });
    await this.notify(notices);
    return round;
  }
}

export class RespondToInvitation extends DistributionUseCase {
  decline(freelancerId: string, invitationId: string) {
    return this.change(invitationId, (round, now) => ({
      effects: round.decline(invitationId, freelancerId, now),
    }));
  }

  withdraw(freelancerId: string, invitationId: string) {
    return this.change(invitationId, (round, now) => ({
      effects: round.withdraw(invitationId, freelancerId, now),
    }));
  }

  submitProposal(freelancerId: string, invitationId: string, input: ProposalInput) {
    return this.change(invitationId, (round, now) => {
      const { effects, first } = round.submitProposal(invitationId, freelancerId, input, now);
      const notice: Notice[] = first
        ? [{ kind: 'proposal', projectId: round.projectId, clientId: round.clientId }]
        : [];
      return { effects, notices: notice };
    });
  }

  private async change(
    invitationId: string,
    apply: (round: DistributionRound, now: Date) => { effects: QueueEffect[]; notices?: Notice[] },
  ): Promise<DistributionRound> {
    const notices: Notice[] = [];
    const round = await this.deps.uow.run(async () => {
      const loaded = await this.roundOfInvitation(invitationId);
      const result = apply(loaded, this.deps.clock.now());
      notices.push(...(result.notices ?? []));
      await this.applyEffects(loaded, result.effects);
      await this.fill(loaded, notices);
      await this.deps.rounds.save(loaded);
      return loaded;
    });
    await this.notify(notices);
    return round;
  }
}

/**
 * Reconciliador de prazos (job a cada minuto): convites sem resposta expiram e a vaga vai para o
 * próximo da fila. O prazo vive no banco; perder um job não perde o prazo.
 */
export class ExpireOverdueInvitations extends DistributionUseCase {
  async execute(batch = 50): Promise<number> {
    let expired = 0;
    for (const roundId of await this.deps.rounds.withOverdueInvitations(
      this.deps.clock.now(),
      batch,
    )) {
      const notices: Notice[] = [];
      await this.deps.uow.run(async () => {
        const round = await this.deps.rounds.findById(roundId);
        if (!round) return;
        const effects = round.expireOverdue(this.deps.clock.now());
        expired += effects.length;
        await this.applyEffects(round, effects);
        await this.fill(round, notices);
        await this.deps.rounds.save(round);
      });
      await this.notify(notices);
    }
    return expired;
  }
}

export class SelectProposal extends DistributionUseCase {
  async execute(clientId: string, projectId: string, input: SelectProposalRequest) {
    const notices: Notice[] = [];
    await this.deps.uow.run(async () => {
      await this.ownedProject(clientId, projectId);
      const round = await this.deps.rounds.findActiveByProject(projectId);
      if (!round) throw new RoundNotFoundError();
      const effects = round.select(input.invitationId, input.feedback, this.deps.clock.now());
      await this.applyEffects(round, effects);
      await this.deps.rounds.save(round);
      await this.deps.projects.hire(projectId, input.invitationId);
      notices.push({
        kind: 'selected',
        projectId,
        freelancerId: round.invitation(input.invitationId).freelancerId,
      });
    });
    await this.notify(notices);
  }
}

/** Pagamento confirmado (chamado pela F6): contratado e não escolhidos atualizam a fila. */
export class FinalizeHiring extends DistributionUseCase {
  execute(projectId: string): Promise<void> {
    return this.deps.uow.run(async () => {
      const round = await this.deps.rounds.findActiveByProject(projectId);
      if (round?.status !== 'SELECTED') return;
      await this.applyEffects(round, round.finalize(this.deps.clock.now()));
      await this.deps.rounds.save(round);
    });
  }
}

/** Prazo de pagamento vencido (F6): o cliente volta a escolher; vagas abertas são repostas. */
export class RevertSelection extends DistributionUseCase {
  async execute(projectId: string): Promise<void> {
    const notices: Notice[] = [];
    await this.deps.uow.run(async () => {
      const round = await this.deps.rounds.findActiveByProject(projectId);
      if (round?.status !== 'SELECTED') return;
      await this.applyEffects(round, round.revertSelection(this.deps.clock.now()));
      await this.deps.projects.revertHiring(projectId);
      await this.fill(round, notices);
      await this.deps.rounds.save(round);
    });
    await this.notify(notices);
  }
}

/** Projeto cancelado pelo cliente: encerra a rodada e devolve a vez a quem tinha proposta. */
export class CancelProjectRound extends DistributionUseCase {
  execute(projectId: string): Promise<void> {
    return this.deps.uow.run(async () => {
      const round = await this.deps.rounds.findActiveByProject(projectId);
      if (!round) return;
      await this.applyEffects(round, round.cancel(this.deps.clock.now()));
      await this.deps.rounds.save(round);
    });
  }
}

export class ReadInvitations extends DistributionUseCase {
  list(input: Parameters<DistributionDeps['queries']['listForFreelancer']>[0]) {
    return this.deps.queries
      .listForFreelancer({ ...input, limit: input.limit + 1 })
      .then((items) => ({
        items: items.slice(0, input.limit),
        hasMore: items.length > input.limit,
      }));
  }

  async get(freelancerId: string, invitationId: string) {
    const round = await this.roundOfInvitation(invitationId);
    const invitation = round.invitation(invitationId);
    if (invitation.freelancerId !== freelancerId) throw new InvitationNotFoundError();
    const project = await this.deps.projects.find(round.projectId);
    if (!project?.scope) throw new InvitationNotFoundError();
    return {
      invitation: invitation.toSnapshot(),
      project: {
        id: project.id,
        title: project.title,
        type: project.type,
        description: project.description,
        scope: toClientScope(project.scope),
      },
    };
  }

  myQueue(userId: string) {
    return this.deps.queries.myQueueStatus(userId);
  }
}

export class ReadProjectProposals extends DistributionUseCase {
  async execute(clientId: string, projectId: string) {
    await this.ownedProject(clientId, projectId);
    return this.deps.queries.proposalsForProject(projectId);
  }
}

export class ManageQueue extends DistributionUseCase {
  list(levelSlug: string | null, state: QueueState) {
    return this.deps.queries.adminQueue({ levelSlug, state });
  }

  async reactivate(adminId: string, userId: string, meta: RequestMeta) {
    await this.deps.uow.run(async () => {
      const entry = await this.deps.queue.find(userId);
      if (!entry) throw new NotFoundError('Freelancer na fila', userId);
      entry.reactivate(this.deps.clock.now());
      await this.deps.queue.save(entry);
      await this.deps.audit.record({
        actorId: adminId,
        action: 'admin.queue_reactivated',
        targetType: 'freelancer',
        targetId: userId,
        request: meta,
      });
    });
    const view = await this.deps.queries.adminQueueEntry(userId);
    if (!view) throw new NotFoundError('Freelancer na fila', userId);
    return view;
  }

  distribution(projectId: string) {
    return this.deps.queries.adminDistribution(projectId);
  }
}
