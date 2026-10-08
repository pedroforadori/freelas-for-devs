import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  DomainEventsProcessor,
  DomainEventsWorkerModule,
} from '../../../shared/infra/queue/domain-events.processor.js';
import { QueueName } from '../../../shared/infra/queue/queue-names.js';
import type { DomainEvent } from '../../../shared/kernel/domain-event.js';
import { FailEstimate, GenerateEstimate } from '../application/use-cases.js';
import { ProjectEvents } from '../domain/project.js';
import {
  EstimationProcessor,
  type EstimationJob,
  RequestEstimateOnProjectChange,
} from './estimation.worker.js';

const event = (type: string, round: number): DomainEvent => ({
  id: 'e1',
  type,
  aggregateType: 'Project',
  aggregateId: 'p1',
  occurredAt: new Date(),
  payload: { projectId: 'p1', round },
});

describe('domain events → estimation queue', () => {
  it('routes project events to the handler, which enqueues one job per round', async () => {
    const add = vi.fn().mockResolvedValue({});
    const moduleRef = await Test.createTestingModule({
      imports: [DomainEventsWorkerModule],
      providers: [
        RequestEstimateOnProjectChange,
        { provide: getQueueToken(QueueName.Estimation), useValue: { add } },
      ],
    }).compile();
    await moduleRef.init();
    const router = moduleRef.get(DomainEventsProcessor);

    expect(await router.route(event(ProjectEvents.Submitted, 1))).toBe(1);
    expect(await router.route(event(ProjectEvents.ClarificationsAnswered, 2))).toBe(1);
    expect(await router.route(event(ProjectEvents.EstimateReady, 1))).toBe(0);

    const calls = add.mock.calls as [string, EstimationJob, { jobId: string }][];
    expect(calls.map(([, data, opts]) => [data, opts.jobId])).toEqual([
      [{ projectId: 'p1', round: 1 }, 'estimate:p1:1'],
      [{ projectId: 'p1', round: 2 }, 'estimate:p1:2'],
    ]);
    await moduleRef.close();
  });
});

describe('EstimationProcessor', () => {
  const job = (attemptsMade: number) =>
    ({
      data: { projectId: 'p1', round: 1 },
      attemptsMade,
      opts: { attempts: 3 },
    }) as unknown as Job<EstimationJob>;

  const setup = () => {
    const generate = { execute: vi.fn().mockRejectedValue(new Error('timeout')) };
    const fail = { execute: vi.fn().mockResolvedValue(true) };
    const processor = new EstimationProcessor(
      generate as unknown as GenerateEstimate,
      fail as unknown as FailEstimate,
    );
    return { processor, fail };
  };

  it('rethrows so BullMQ retries while attempts remain', async () => {
    const { processor, fail } = setup();
    await expect(processor.process(job(0))).rejects.toThrow('timeout');
    expect(fail.execute).not.toHaveBeenCalled();
  });

  it('hands the project to the specialist on the last attempt', async () => {
    const { processor, fail } = setup();
    await expect(processor.process(job(2))).resolves.toBe('failed');
    expect(fail.execute).toHaveBeenCalledWith('p1', 1);
  });
});
