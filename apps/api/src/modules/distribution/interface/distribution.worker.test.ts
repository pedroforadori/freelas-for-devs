import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '../../../shared/kernel/domain-event.js';
import { ProfileEvents } from '../../profiles/domain/freelancer-profile.js';
import { ProjectEvents } from '../../projects/domain/project.js';
import type { CancelProjectRound, OpenRound, SyncQueueEntry } from '../application/use-cases.js';
import { DistributionEventHandler, DistributionEventTypes } from './distribution.worker.js';

const event = (type: string, payload: Record<string, unknown>): DomainEvent => ({
  id: 'e1',
  type,
  aggregateType: 'X',
  aggregateId: 'a1',
  occurredAt: new Date(),
  payload,
});

describe('DistributionEventHandler', () => {
  it('listens to the exact event types the other modules publish', () => {
    expect(DistributionEventTypes).toEqual({
      ProfileApproved: ProfileEvents.Approved,
      LevelChanged: ProfileEvents.LevelChanged,
      ScopeApproved: ProjectEvents.ScopeApproved,
      ProjectCancelled: ProjectEvents.Cancelled,
    });
  });

  it('reads the payload fields those modules record', async () => {
    const sync = { execute: vi.fn() };
    const open = { execute: vi.fn() };
    const cancel = { execute: vi.fn() };
    const handler = new DistributionEventHandler(
      sync as unknown as SyncQueueEntry,
      open as unknown as OpenRound,
      cancel as unknown as CancelProjectRound,
    );
    await handler.handle(event(ProfileEvents.Approved, { userId: 'u1', level: 'iniciante' }));
    await handler.handle(
      event(ProfileEvents.LevelChanged, { userId: 'u1', from: 'iniciante', to: 'avancado' }),
    );
    await handler.handle(event(ProjectEvents.ScopeApproved, { projectId: 'p1', version: 1 }));
    await handler.handle(event(ProjectEvents.Cancelled, { projectId: 'p1', clientId: 'c1' }));
    expect(sync.execute.mock.calls).toEqual([
      ['u1', 'iniciante'],
      ['u1', 'avancado'],
    ]);
    expect(open.execute).toHaveBeenCalledWith('p1');
    expect(cancel.execute).toHaveBeenCalledWith('p1');
  });
});
