import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { EVENT_DISPATCHER, type EventDispatcher } from '../../application/event-dispatcher.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import type { Database } from '../database/database-context.js';
import { DATABASE } from '../database/database.module.js';
import { DrizzleOutboxStore } from './drizzle-outbox.store.js';
import { OutboxRelay } from './outbox-relay.js';

/** Executa o relay em laço, sem sobreposição de ciclos, e para de forma graciosa no shutdown. */
@Injectable()
export class OutboxRelayRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayRunner.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly relay: OutboxRelay,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = undefined;
      });
    }, delay);
  }

  private async tick(): Promise<void> {
    let drained = true;
    try {
      const summary = await this.relay.relayOnce();
      if (summary.failed > 0)
        this.logger.warn({ ...summary }, 'Outbox: falhas ao publicar eventos');
      // Lote cheio sugere backlog: roda de novo imediatamente.
      drained = summary.published + summary.failed < this.env.OUTBOX_BATCH_SIZE;
    } catch (error) {
      this.logger.error(error, 'Outbox: ciclo do relay falhou');
    }
    this.schedule(drained ? this.env.OUTBOX_POLL_INTERVAL_MS : 0);
  }
}

@Module({
  providers: [
    {
      provide: OutboxRelay,
      inject: [DATABASE, EVENT_DISPATCHER, ENV],
      useFactory: (db: Database, dispatcher: EventDispatcher, env: Env) =>
        new OutboxRelay(new DrizzleOutboxStore(db), dispatcher, env.OUTBOX_BATCH_SIZE),
    },
    OutboxRelayRunner,
  ],
})
export class OutboxRelayModule {}
