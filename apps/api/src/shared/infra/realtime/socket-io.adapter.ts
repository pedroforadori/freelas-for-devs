import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO com CORS restrito às origens do web (cookies de sessão) e, em produção, adapter Redis:
 * mensagens emitidas em uma réplica chegam aos sockets conectados nas demais.
 */
export class AppIoAdapter extends IoAdapter {
  private readonly log = new Logger('Realtime');
  private redisAdapter: ReturnType<typeof createAdapter> | undefined;

  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  /** Liga o adapter Redis (pub/sub). Sem ele, cada réplica só alcança os próprios sockets. */
  connectToRedis(redisUrl: string): void {
    const pub = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    for (const client of [pub, sub]) {
      client.on('error', (error: Error) =>
        this.log.warn({ err: error.message }, 'Redis do tempo real indisponível'),
      );
    }
    this.redisAdapter = createAdapter(pub, sub);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const hardened = {
      ...options,
      cors: { origin: this.origins, credentials: true },
      // Mensagens são pequenas; limite baixo evita abuso de memória.
      maxHttpBufferSize: 64 * 1024,
    } as ServerOptions;
    const server = super.createIOServer(port, hardened);
    if (this.redisAdapter) server.adapter(this.redisAdapter);
    return server;
  }
}
