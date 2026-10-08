import { Processor } from '@nestjs/bullmq';
import { ReportingWorkerHost } from './reporting-worker-host.js';
import { Injectable, Logger, Module, type OnModuleInit, SetMetadata } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import type { Job } from 'bullmq';
import type { DomainEvent } from '../../kernel/domain-event.js';
import type { DomainEventJob } from './bullmq-event-dispatcher.js';
import { QueueName } from './queue-names.js';

const HANDLES_KEY = 'f4d:domain-event-handler';

/** Consumidor de eventos de domínio. Precisa ser idempotente: a entrega é at-least-once. */
export interface DomainEventHandler {
  handle(event: DomainEvent): Promise<void>;
}

/**
 * Marca um provider como handler dos tipos de evento informados. O roteador o encontra sozinho
 * (DiscoveryService): cada módulo registra seus handlers no próprio módulo de worker.
 */
export const HandlesDomainEvents = (...types: string[]) => SetMetadata(HANDLES_KEY, types);

/**
 * Lê a fila `domain-events` (alimentada pelo relay do outbox) e entrega cada evento aos handlers
 * do seu tipo. Se um handler falhar, o job inteiro é repetido — por isso todos são idempotentes
 * (ex.: enfileiram com jobId determinístico). Eventos sem handler são apenas confirmados.
 */
@Processor(QueueName.DomainEvents, { concurrency: 10 })
@Injectable()
export class DomainEventsProcessor extends ReportingWorkerHost implements OnModuleInit {
  private readonly logger = new Logger('DomainEvents');
  private readonly handlers = new Map<string, DomainEventHandler[]>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {
    super();
  }

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as DomainEventHandler | undefined;
      const { metatype } = wrapper;
      if (!instance || !metatype) continue;
      const types = this.reflector.get<string[] | undefined>(HANDLES_KEY, metatype);
      if (!types) continue;
      for (const type of types) {
        this.handlers.set(type, [...(this.handlers.get(type) ?? []), instance]);
      }
    }
    this.logger.log({ types: [...this.handlers.keys()] }, 'Handlers de eventos registrados');
  }

  async process(job: Job<DomainEventJob>): Promise<void> {
    await this.route({ ...job.data, occurredAt: new Date(job.data.occurredAt) });
  }

  /** Exposto para testes: entrega um evento como o worker faria. */
  async route(event: DomainEvent): Promise<number> {
    const handlers = this.handlers.get(event.type) ?? [];
    for (const handler of handlers) await handler.handle(event);
    return handlers.length;
  }
}

@Module({
  imports: [DiscoveryModule],
  providers: [DomainEventsProcessor],
})
export class DomainEventsWorkerModule {}
