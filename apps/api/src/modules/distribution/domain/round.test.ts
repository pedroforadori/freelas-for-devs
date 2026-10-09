import { describe, expect, it } from 'vitest';
import { HOUR_MS } from '../../../shared/kernel/clock.js';
import { InvalidStateTransitionError } from '../../../shared/kernel/domain-error.js';
import { InvitationNotFoundError, ProposalOutOfScopeError } from './errors.js';
import { invitationMachine } from './invitation.js';
import { QueueEntry } from './queue-entry.js';
import { DistributionRound, RoundEvents } from './round.js';

const now = new Date('2026-10-10T12:00:00Z');
const proposal = { amountCents: 500_000, deadlineDays: 30, message: 'x'.repeat(100) };

const open = (overrides: Partial<{ roundSize: number; maxInvites: number }> = {}) =>
  DistributionRound.open({
    id: 'r1',
    projectId: 'p1',
    clientId: 'c1',
    levelSlug: 'iniciante',
    projectType: 'SITE',
    requiredStacks: [],
    openedAt: now,
    params: {
      roundSize: 2,
      maxInvites: 4,
      inviteResponseHours: 48,
      maxOpenInvitesPerFreelancer: 3,
      roundsBeforeMonitoring: 2,
      priceMinCents: 300_000,
      priceMaxCents: 600_000,
      maxDeadlineDays: 40,
      ...overrides,
    },
  });

const invite = (round: DistributionRound, ...freelancers: string[]) =>
  round.invite(
    freelancers.map((freelancerId) => ({ id: `i-${freelancerId}`, freelancerId })),
    now,
  );

describe('DistributionRound', () => {
  it('keeps at most K active invitations and respects the total budget', () => {
    const round = open();
    expect(round.openSlots()).toBe(2);
    invite(round, 'f1', 'f2');
    expect(round.openSlots()).toBe(0);
    expect(() => invite(round, 'f3')).toThrow(InvalidStateTransitionError);

    // Recusa repõe a vaga na hora; o teto total (4) limita as reposições.
    expect(round.decline('i-f1', 'f1', now)).toEqual([
      { kind: 'lostTurn', freelancerId: 'f1', reason: 'DECLINED' },
    ]);
    expect(round.openSlots()).toBe(1);
    invite(round, 'f3');
    round.decline('i-f3', 'f3', now);
    invite(round, 'f4');
    round.decline('i-f4', 'f4', now);
    expect(round.openSlots()).toBe(0);
    expect(round.invitedFreelancerIds).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('expires only overdue invitations', () => {
    const round = open();
    invite(round, 'f1', 'f2');
    round.submitProposal('i-f2', 'f2', proposal, now);
    expect(round.expireOverdue(new Date(now.getTime() + 47 * HOUR_MS))).toEqual([]);
    expect(round.expireOverdue(new Date(now.getTime() + 48 * HOUR_MS))).toEqual([
      { kind: 'lostTurn', freelancerId: 'f1', reason: 'EXPIRED' },
    ]);
    expect(round.invitation('i-f2').status).toBe('PROPOSAL_SUBMITTED');
  });

  it('validates proposals against the approved scope and lets them be edited', () => {
    const round = open();
    invite(round, 'f1');
    expect(() =>
      round.submitProposal('i-f1', 'f1', { ...proposal, amountCents: 700_000 }, now),
    ).toThrow(ProposalOutOfScopeError);
    expect(() =>
      round.submitProposal('i-f1', 'f1', { ...proposal, deadlineDays: 60 }, now),
    ).toThrow('O prazo máximo deste projeto é de 40 dias.');
    expect(() => round.submitProposal('i-f1', 'intruso', proposal, now)).toThrow(
      InvitationNotFoundError,
    );

    expect(round.submitProposal('i-f1', 'f1', proposal, now)).toEqual({
      effects: [{ kind: 'answered', freelancerId: 'f1' }],
      first: true,
    });
    const later = new Date(now.getTime() + HOUR_MS);
    expect(
      round.submitProposal('i-f1', 'f1', { ...proposal, amountCents: 450_000 }, later).first,
    ).toBe(false);
    expect(round.invitation('i-f1').proposal).toMatchObject({
      amountCents: 450_000,
      submittedAt: now,
      updatedAt: later,
    });
  });

  it('selects one proposal, holds the others and voids unanswered invitations', () => {
    const round = open({ roundSize: 3 });
    invite(round, 'f1', 'f2', 'f3');
    round.submitProposal('i-f1', 'f1', proposal, now);
    round.submitProposal('i-f2', 'f2', proposal, now);

    expect(
      round.select('i-f1', [{ invitationId: 'i-f2', reasons: ['PRICE', 'PRICE'] }], now),
    ).toEqual([{ kind: 'voided', freelancerId: 'f3', wasAwaitingResponse: true }]);
    expect(round.status).toBe('SELECTED');
    expect(round.invitation('i-f2').toSnapshot()).toMatchObject({
      status: 'ON_HOLD',
      feedback: ['PRICE'],
    });
    expect(round.openSlots()).toBe(0);

    // Pagamento confirmado (F6).
    expect(round.finalize(now)).toEqual([
      { kind: 'hired', freelancerId: 'f1' },
      { kind: 'notSelected', freelancerId: 'f2' },
    ]);
    expect(round.status).toBe('CLOSED');
    expect(round.pullEvents().map((e) => e.type)).toContain(RoundEvents.ProposalSelected);
  });

  it('compensates proposers when the project is cancelled', () => {
    const round = open();
    invite(round, 'f1', 'f2');
    round.submitProposal('i-f2', 'f2', proposal, now);
    expect(round.cancel(now)).toEqual([
      { kind: 'voided', freelancerId: 'f1', wasAwaitingResponse: true },
      { kind: 'compensate', freelancerId: 'f2' },
    ]);
    expect(round.status).toBe('CANCELLED');
    expect(round.cancel(now)).toEqual([]);
  });

  it('documents the invitation lifecycle as Mermaid', () => {
    const diagram = invitationMachine.toMermaid();
    expect(diagram).toContain('INVITED --> PROPOSAL_SUBMITTED: submitProposal');
    expect(diagram).toContain('PROPOSAL_SUBMITTED --> ON_HOLD: hold');
    expect(diagram).toContain('ON_HOLD --> NOT_SELECTED: notSelect');
  });
});

describe('QueueEntry (fairness rules)', () => {
  it('loses the turn on decline or no response, keeping counters', () => {
    const entry = QueueEntry.create('f1', 'iniciante', now);
    entry.invited(now);
    entry.notSelected(5, now);
    expect(entry.toSnapshot()).toMatchObject({ tier: 'PRIORITY', openInvitations: 1 });

    const later = new Date(now.getTime() + HOUR_MS);
    entry.lostTurn('EXPIRED', later);
    expect(entry.toSnapshot()).toMatchObject({
      tier: 'NORMAL',
      prioritySince: null,
      lastInvitedAt: later,
      openInvitations: 0,
      noResponses: 1,
    });
  });

  it('gives priority after a non-selection and moves to monitoring after N rounds', () => {
    const entry = QueueEntry.create('f1', 'iniciante', now);
    entry.notSelected(2, now);
    const first = entry.toSnapshot().prioritySince;
    entry.notSelected(2, new Date(now.getTime() + HOUR_MS));
    expect(entry.toSnapshot()).toMatchObject({
      state: 'MONITORING',
      tier: 'NORMAL',
      roundsWithoutSelection: 2,
    });
    expect(first).toEqual(now);

    entry.reactivate(now);
    expect(entry.toSnapshot()).toMatchObject({
      state: 'ACTIVE',
      tier: 'PRIORITY',
      roundsWithoutSelection: 0,
    });
    expect(() => entry.reactivate(now)).toThrow(InvalidStateTransitionError);
  });

  it('resets after being hired and is compensated without counting a round', () => {
    const entry = QueueEntry.create('f1', 'iniciante', now);
    entry.compensate(now);
    expect(entry.toSnapshot()).toMatchObject({ tier: 'PRIORITY', roundsWithoutSelection: 0 });
    entry.hired(now);
    expect(entry.toSnapshot()).toMatchObject({
      tier: 'NORMAL',
      selections: 1,
      lastInvitedAt: now,
    });
  });
});
