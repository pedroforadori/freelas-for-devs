import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../../../shared/kernel/domain-error.js';
import { computeAmounts } from './commission.js';
import {
  Contract,
  ContractEvents,
  contractMachine,
  DeliveryRuleError,
  deliveryMachine,
  NotParticipantError,
} from './contract.js';
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
  const DAY = 24 * 3600_000;
  const params = { reviewDays: 5, autoApproveDays: 7, maxCorrections: 1 };
  const delivery = { message: 'Entrega com o layout aprovado.', links: [], attachmentIds: [] };
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
  const funded = () => {
    const contract = create();
    contract.fund(params, now);
    return contract;
  };
  const at = (days: number) => new Date(now.getTime() + days * DAY);

  it('is funded once, then works through three deliveries with adjustments', () => {
    const contract = funded();
    expect(contract.toSnapshot()).toMatchObject({
      status: 'ACTIVE',
      stage: 'WORKING_D1',
      dueAt: at(30),
    });
    expect(() => contract.expire(now)).toThrow(InvalidStateTransitionError);

    expect(contract.deliver('dev', delivery, at(10)).reviewDeadlineAt).toEqual(at(15));
    contract.requestAdjustments('client', [{ id: 'a1', text: 'Trocar a cor do botão' }], at(11));
    expect(contract.stage).toBe('WORKING_D2');
    contract.deliver('dev', delivery, at(15));
    contract.requestAdjustments('client', [{ id: 'a2', text: 'Ajustar o rodapé' }], at(16));
    // A entrega final tem o prazo de aprovação automática.
    expect(contract.deliver('dev', delivery, at(20)).reviewDeadlineAt).toEqual(at(27));
    expect(contract.stage).toBe('FINAL_REVIEW');

    contract.approve('CLIENT', 'client', at(21));
    expect(contract.toSnapshot()).toMatchObject({
      status: 'APPROVED',
      stage: null,
      approvalKind: 'CLIENT',
    });
    contract.release('tr_1', at(21));
    expect(contract.status).toBe('RELEASED');
    expect(contract.pullEvents().map((e) => e.type)).toEqual([
      ContractEvents.Created,
      ContractEvents.Funded,
      ContractEvents.DeliverySubmitted,
      ContractEvents.AdjustmentsRequested,
      ContractEvents.DeliverySubmitted,
      ContractEvents.AdjustmentsRequested,
      ContractEvents.DeliverySubmitted,
      ContractEvents.Approved,
      ContractEvents.Released,
    ]);
  });

  it('lets only the right party act, and only at the right stage', () => {
    const contract = funded();
    expect(() => contract.deliver('client', delivery, now)).toThrow(NotParticipantError);
    expect(() => contract.approve('CLIENT', 'client', now)).toThrow(DeliveryRuleError);
    contract.deliver('dev', delivery, now);
    expect(() => contract.deliver('dev', delivery, now)).toThrow(InvalidStateTransitionError);
    expect(() => contract.requestAdjustments('dev', [], now)).toThrow(NotParticipantError);
    // Correção pontual só na entrega final.
    expect(() => contract.requestCorrection('client', [], null, now)).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('advances on review timeout and auto-approves the final delivery', () => {
    const contract = funded();
    contract.deliver('dev', delivery, now);
    expect(contract.reviewTimeout(at(4))).toBeNull();
    expect(contract.reviewTimeout(at(5))).toBe('ADVANCED');
    expect(contract.stage).toBe('WORKING_D2');
    expect(contract.toSnapshot().deliveries[0]).toMatchObject({
      outcome: 'TIMEOUT',
      adjustments: [],
    });

    contract.deliver('dev', delivery, at(6));
    contract.reviewTimeout(at(11));
    contract.deliver('dev', delivery, at(12));
    expect(contract.reviewTimeout(at(18))).toBeNull();
    expect(contract.reviewTimeout(at(19))).toBe('AUTO_APPROVED');
    expect(contract.toSnapshot()).toMatchObject({ status: 'APPROVED', approvalKind: 'AUTO' });
  });

  it('allows a limited correction of already requested adjustments only', () => {
    const contract = funded();
    contract.deliver('dev', delivery, now);
    contract.requestAdjustments('client', [{ id: 'a1', text: 'Trocar a cor do botão' }], now);
    contract.deliver('dev', delivery, now);
    contract.reviewTimeout(at(5));
    contract.deliver('dev', delivery, at(6));

    expect(() => contract.requestCorrection('client', ['novo'], null, at(7))).toThrow(
      'fora de escopo',
    );
    contract.requestCorrection('client', ['a1'], 'O botão continua azul', at(7));
    expect(contract.stage).toBe('WORKING_FINAL');
    expect(contract.correctionsLeft()).toBe(0);
    contract.deliver('dev', delivery, at(8));
    expect(() => contract.requestCorrection('client', ['a1'], null, at(9))).toThrow('limite');
  });

  it('documents both lifecycles as Mermaid', () => {
    expect(contractMachine.toMermaid()).toContain('AWAITING_PAYMENT --> ACTIVE: fund');
    expect(deliveryMachine.toMermaid()).toContain(
      'FINAL_REVIEW --> WORKING_FINAL: requestCorrection',
    );
  });
});
