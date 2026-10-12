import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '../../../shared/kernel/domain-event.js';
import { RoundEvents } from '../../distribution/domain/round.js';
import { ProjectEvents } from '../../projects/domain/project.js';
import type {
  CancelContractForProject,
  CreateContractForSelection,
  ReleasePayment,
} from '../application/use-cases.js';
import type { ExecuteSettlement } from '../application/disputes.js';
import { DisputeEvents } from '../domain/dispute.js';
import { ContractEvents } from '../domain/contract.js';
import { ContractsEventHandler, ContractsEventTypes } from './contracts.worker.js';

const event = (type: string, payload: Record<string, unknown>): DomainEvent => ({
  id: 'e1',
  type,
  aggregateType: 'X',
  aggregateId: 'a1',
  occurredAt: new Date(),
  payload,
});

describe('ContractsEventHandler', () => {
  it('listens to the events published by distribution and projects', () => {
    expect(ContractsEventTypes).toEqual({
      ProposalSelected: RoundEvents.ProposalSelected,
      ProjectCancelled: ProjectEvents.Cancelled,
      ContractApproved: ContractEvents.Approved,
      DisputeResolved: DisputeEvents.Resolved,
    });
  });

  it('creates the contract from the selection payload', async () => {
    const create = { execute: vi.fn() };
    const cancel = { execute: vi.fn() };
    const settle = { execute: vi.fn() };
    const handler = new ContractsEventHandler(
      create as unknown as CreateContractForSelection,
      cancel as unknown as CancelContractForProject,
      { execute: vi.fn() } as unknown as ReleasePayment,
      settle as unknown as ExecuteSettlement,
    );
    await handler.handle(
      event(RoundEvents.ProposalSelected, {
        roundId: 'r1',
        projectId: 'p1',
        clientId: 'c1',
        invitationId: 'i1',
        freelancerId: 'f1',
        amountCents: 300_000,
        deadlineDays: 25,
      }),
    );
    await handler.handle(event(ProjectEvents.Cancelled, { projectId: 'p1', clientId: 'c1' }));
    expect(create.execute).toHaveBeenCalledWith({
      projectId: 'p1',
      invitationId: 'i1',
      clientId: 'c1',
      freelancerId: 'f1',
      amountCents: 300_000,
      deadlineDays: 25,
    });
    expect(cancel.execute).toHaveBeenCalledWith('p1');
    await handler.handle(event(DisputeEvents.Resolved, { disputeId: 'd1', contractId: 'k1' }));
    expect(settle.execute).toHaveBeenCalledWith('d1');
  });
});
