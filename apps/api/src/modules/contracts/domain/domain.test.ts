import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../../../shared/kernel/domain-error.js';
import { computeAmounts } from './commission.js';
import { Contract, ContractEvents, contractMachine } from './contract.js';
import { fundingJournal, refundJournal, releaseJournal, UnbalancedJournalError } from './ledger.js';

const now = new Date('2026-10-10T12:00:00Z');

describe('computeAmounts', () => {
  it('applies the commission to whoever pays it, never losing a cent', () => {
    expect(computeAmounts(300_000, 1000, 'FREELANCER')).toMatchObject({
      platformFeeCents: 30_000,
      clientTotalCents: 300_000,
      freelancerNetCents: 270_000,
    });
    expect(computeAmounts(300_000, 1000, 'CLIENT')).toMatchObject({
      clientTotalCents: 330_000,
      freelancerNetCents: 300_000,
    });
    const split = computeAmounts(100_001, 1000, 'SPLIT');
    expect(split.platformFeeCents).toBe(10_000);
    expect(split.clientTotalCents - split.freelancerNetCents).toBe(split.platformFeeCents);
    for (const payer of ['CLIENT', 'FREELANCER', 'SPLIT'] as const) {
      const amounts = computeAmounts(123_457, 1234, payer);
      expect(amounts.clientTotalCents).toBe(amounts.freelancerNetCents + amounts.platformFeeCents);
    }
  });
});

describe('ledger journals', () => {
  const base = { id: 'j1', contractId: 'c1', reference: null, createdAt: now };

  it('balances funding, refund and release', () => {
    const sum = (lines: { debitCents: number; creditCents: number }[]) => [
      lines.reduce((s, l) => s + l.debitCents, 0),
      lines.reduce((s, l) => s + l.creditCents, 0),
    ];
    for (const journal of [
      fundingJournal(base, 330_000),
      refundJournal(base, 330_000),
      releaseJournal(base, { freelancerNetCents: 300_000, platformFeeCents: 30_000 }),
    ]) {
      const [debits, credits] = sum(journal.lines);
      expect(debits).toBe(credits);
    }
  });

  it('refuses empty or fractional amounts', () => {
    expect(() => fundingJournal(base, 0)).toThrow(UnbalancedJournalError);
    expect(() => fundingJournal(base, 10.5)).toThrow(UnbalancedJournalError);
  });
});

describe('Contract', () => {
  const create = () =>
    Contract.create({
      id: 'c1',
      projectId: 'p1',
      invitationId: 'i1',
      clientId: 'client',
      freelancerId: 'dev',
      amounts: computeAmounts(300_000, 1000, 'FREELANCER'),
      deadlineDays: 30,
      paymentDeadlineAt: new Date(now.getTime() + 72 * 3600_000),
      now,
    });

  it('is funded once, then cannot expire', () => {
    const contract = create();
    contract.fund(now);
    expect(contract.status).toBe('FUNDED');
    expect(() => contract.expire(now)).toThrow(InvalidStateTransitionError);
    expect(contract.pullEvents().map((e) => e.type)).toEqual([
      ContractEvents.Created,
      ContractEvents.Funded,
    ]);
    expect(contract.isParticipant('dev')).toBe(true);
    expect(contract.isParticipant('outro')).toBe(false);
  });

  it('documents its lifecycle as Mermaid', () => {
    expect(contractMachine.toMermaid()).toContain('AWAITING_PAYMENT --> FUNDED: fund');
  });
});
