import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { EventDispatcher } from '../../application/event-dispatcher.js';
import type { DomainEvent } from '../../kernel/domain-event.js';
import { QueueName } from './queue-names.js';

export interface DomainEventJob {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/**
 * Publica eventos na fila `domain-events`. O `jobId` igual ao id do evento torna a
 * publicação idempotente: se o relay reenviar após uma falha, o BullMQ descarta a duplicata.
 */
@Injectable()
export class BullMqEventDispatcher implements EventDispatcher {
  constructor(@InjectQueue(QueueName.DomainEvents) private readonly queue: Queue<DomainEventJob>) {}

  async dispatch(event: DomainEvent): Promise<void> {
    await this.queue.add(
      event.type,
      {
        id: event.id,
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        occurredAt: event.occurredAt.toISOString(),
        payload: event.payload,
      },
      { jobId: event.id },
    );
  }
}
