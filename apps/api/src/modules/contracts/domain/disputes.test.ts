import { describe, expect, it } from 'vitest';
import { computeAmounts } from './commission.js';
import { Contract, ContractEvents, contractMachine, DeliveryRuleError } from './contract.js';
import { computeSettlement, Dispute, disputeMachine } from './dispute.js';
import { OutOfScopeRequest, outOfScopeMachine } from './out-of-scope.js';
import { Payment } from './payment.js';

const DAY = 24 * 3600_000;
const now = new Date('2026-10-10T12:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * DAY);
const params = { reviewDays: 5, autoApproveDays: 7, maxCorrections: 1 };
const delivery = { message: 'Entrega com o layout aprovado.', links: [], attachmentIds: [] };

const funded = () => {
  const contract = Contract.create({
    id: 'c1',
    projectId: 'p1',
    invitationId: 'i1',
    clientId: 'client',
    freelancerId: 'dev',
    amounts: computeAmounts(300_000, 1000, 'FREELANCER'),
    deadlineDays: 30,
    paymentDeadlineAt: at(3),
    now,
  });
  contract.fund(params, now);
  contract.pullEvents();
  return contract;
};

const extra = (id = 'x1') =>
  OutOfScopeRequest.flag({
    id,
    contractId: 'c1',
    projectId: 'p1',
    description: 'Cliente pediu uma área de login que não estava no escopo.',
    amounts: computeAmounts(50_000, 1000, 'FREELANCER'),
    extraDays: 5,
    now,
  });

describe('Contract holds (paused deadlines)', () => {
  it('pauses deadlines while held and extends them by the paused time', () => {
    const contract = funded();
    expect(contract.deliver('dev', delivery, at(10)).reviewDeadlineAt).toEqual(at(15));
    contract.hold('oos:x1', at(12));
    contract.hold('oos:x2', at(13));
    // Pausado: a revisão não vence nem avança.
    expect(contract.reviewTimeout(at(20))).toBeNull();
    contract.releaseHold('oos:x1', at(14));
    expect(contract.paused).toBe(true);
    contract.releaseHold('oos:x2', at(16));
    expect(contract.paused).toBe(false);
    // 4 dias parado: prazo combinado e revisão em curso andam 4 dias.
    expect(contract.dueAt).toEqual(at(34));
    expect(contract.currentDelivery?.reviewDeadlineAt).toEqual(at(19));
    expect(contract.reviewTimeout(at(18))).toBeNull();
    expect(contract.reviewTimeout(at(19))).toBe('ADVANCED');
  });

  it('blocks approval while an out-of-scope request is pending', () => {
    const contract = funded();
    contract.deliver('dev', delivery, at(1));
    contract.hold('oos:x1', at(2));
    expect(() => contract.approve('CLIENT', 'client', at(2))).toThrow(DeliveryRuleError);
    contract.releaseHold('oos:x1', at(3));
    contract.approve('CLIENT', 'client', at(3));
    expect(contract.status).toBe('APPROVED');
  });

  it('adds a funded extra to the escrowed amounts and the agreed deadline', () => {
    const contract = funded();
    const request = extra();
    contract.addExtra(request.amounts, request.extraDays, request.id, at(1));
    expect(contract.amounts).toMatchObject({
      proposalCents: 350_000,
      platformFeeCents: 35_000,
      clientTotalCents: 350_000,
      freelancerNetCents: 315_000,
    });
    expect(contract.dueAt).toEqual(at(35));
  });

  it('freezes on dispute, resumes on withdrawal and settles on decision', () => {
    const contract = funded();
    contract.openDispute('d1', 'ABANDONMENT', at(5));
    expect(contract.status).toBe('DISPUTED');
    expect(contract.pullEvents().map((e) => e.type)).toEqual([
      ContractEvents.Disputed,
      ContractEvents.Abandoned,
    ]);
    expect(() => contract.deliver('dev', delivery, at(6))).toThrow(DeliveryRuleError);
    contract.resumeAfterDispute('d1', at(7));
    expect(contract.status).toBe('ACTIVE');
    expect(contract.dueAt).toEqual(at(32));
    contract.openDispute('d2', 'DISPUTE', at(8));
    contract.settle('d2', at(9));
    expect(contract.toSnapshot()).toMatchObject({ status: 'SETTLED', holds: [], stage: null });
    expect(contractMachine.toMermaid()).toContain('DISPUTED --> SETTLED: settle');
  });
});

describe('OutOfScopeRequest', () => {
  it('goes from proposal to payment, or through mediation', () => {
    const paid = extra();
    paid.accept(at(3), now);
    paid.fund(at(1));
    expect(paid.status).toBe('ACCEPTED_FUNDED');
    expect(paid.pending).toBe(false);

    const contested = extra('x2');
    contested.contest('O login estava na lista de funcionalidades aprovada.', now);
    contested.rule({ decision: 'OUT_OF_SCOPE', note: 'Não estava no escopo.', adminId: 'a' }, now);
    expect(contested.status).toBe('EXTRA_PROPOSED');
    contested.withdraw(now);
    expect(() => contested.accept(at(3), now)).toThrow(DeliveryRuleError);

    const inScope = extra('x3');
    inScope.contest('Estava no escopo aprovado, item 3.', now);
    inScope.rule({ decision: 'IN_SCOPE', note: 'Item 3 do escopo.', adminId: 'a' }, now);
    expect(inScope.status).toBe('RULED_IN_SCOPE');
    expect(outOfScopeMachine.toMermaid()).toContain('CONTESTED --> RULED_IN_SCOPE: ruleInScope');
  });
});

describe('Dispute', () => {
  const open = (kind: 'DISPUTE' | 'ABANDONMENT' = 'DISPUTE') =>
    Dispute.open({
      id: 'd1',
      contractId: 'c1',
      projectId: 'p1',
      kind,
      openedBy: 'CLIENT',
      openerId: 'client',
      reason: 'QUALITY',
      description: 'A entrega final não funciona no celular e o dev não responde.',
      evidenceDeadlineAt: at(3),
      now,
    });

  it('collects both versions, then goes to review', () => {
    const dispute = open();
    dispute.addStatement(
      { role: 'CLIENT', userId: 'client', text: 'Prints em anexo.', attachmentIds: [] },
      at(1),
    );
    expect(dispute.status).toBe('OPEN');
    expect(dispute.startReviewIfReady(at(2))).toBe(false);
    dispute.addStatement(
      { role: 'FREELANCER', userId: 'dev', text: 'Funciona, ver vídeo.', attachmentIds: [] },
      at(2),
    );
    expect(dispute.status).toBe('UNDER_REVIEW');
    expect(() => dispute.withdraw('client', at(2))).toThrow('análise');
  });

  it('goes to review after the deadline even if one side is silent', () => {
    const dispute = open();
    expect(dispute.startReviewIfReady(at(3))).toBe(true);
  });

  it('only lets the opener withdraw a regular dispute', () => {
    expect(() => open().withdraw('dev', at(1))).toThrow('Só quem abriu');
    expect(() => open('ABANDONMENT').withdraw('client', at(1))).toThrow('Só quem abriu');
    const dispute = open();
    dispute.withdraw('client', at(1));
    expect(dispute.status).toBe('WITHDRAWN');
  });

  it('splits the escrow by the decided share and tracks execution', () => {
    const amounts = computeAmounts(300_000, 1000, 'FREELANCER');
    const dispute = open();
    const resolution = dispute.resolve(
      { adminId: 'a', freelancerShareBps: 6000, note: 'Entregou 60% do combinado.', amounts },
      at(4),
    );
    expect(resolution).toMatchObject({
      freelancerCents: 162_000,
      platformFeeCents: 18_000,
      refundCents: 120_000,
    });
    expect(dispute.executed).toBe(false);
    dispute.markRefunded(at(4));
    dispute.markTransferred('tr_1', at(4));
    expect(dispute.executed).toBe(true);
    dispute.close(at(4));
    expect(dispute.status).toBe('CLOSED');
    expect(disputeMachine.toMermaid()).toContain('OPEN --> EXECUTING: resolve');
  });

  it('never loses or creates a cent in the split', () => {
    for (const payer of ['CLIENT', 'FREELANCER', 'SPLIT'] as const) {
      const amounts = computeAmounts(123_457, 1234, payer);
      for (const bps of [0, 1, 3333, 5000, 9999, 10_000]) {
        const s = computeSettlement(amounts, bps);
        expect(s.freelancerCents + s.platformFeeCents + s.refundCents).toBe(
          amounts.clientTotalCents,
        );
        expect(
          Math.min(s.freelancerCents, s.platformFeeCents, s.refundCents),
        ).toBeGreaterThanOrEqual(0);
      }
    }
    expect(computeSettlement(computeAmounts(300_000, 1000, 'CLIENT'), 0)).toEqual({
      freelancerCents: 0,
      platformFeeCents: 0,
      refundCents: 330_000,
    });
  });
});

describe('Payment partial refunds', () => {
  it('refunds part of a payment and becomes REFUNDED when fully returned', () => {
    const payment = Payment.start({
      id: 'pay1',
      contractId: 'c1',
      provider: 'fake',
      providerCheckoutId: 'cs_1',
      checkoutUrl: 'https://pay',
      checkoutExpiresAt: at(1),
      amountCents: 300_000,
      createdAt: now,
    });
    payment.succeed('pi_1', now);
    payment.refundPartially(100_000, at(1));
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.refundableCents).toBe(200_000);
    expect(() => payment.refundPartially(200_001, at(1))).toThrow(RangeError);
    payment.refundPartially(200_000, at(2));
    expect(payment.status).toBe('REFUNDED');
    expect(payment.refundableCents).toBe(0);
  });
});
