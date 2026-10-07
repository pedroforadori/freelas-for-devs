import { connect } from 'node:net';
import { Logger } from '@nestjs/common';
import type { MalwareScanner, ScanVerdict } from '../application/ports.js';

const CHUNK = 64 * 1024;

/**
 * Cliente do clamd pelo protocolo INSTREAM (TCP): o conteúdo vai em blocos com prefixo de
 * tamanho (uint32 big-endian) e termina com um bloco vazio. Resposta: "stream: OK" ou
 * "stream: <assinatura> FOUND". Qualquer outra coisa é erro (o job é repetido).
 */
export class ClamAvScanner implements MalwareScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 30_000,
  ) {}

  scan(content: Uint8Array): Promise<ScanVerdict> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('ClamAV: tempo esgotado')));
      socket.on('error', reject);
      socket.on('data', (data) => chunks.push(data));
      socket.on('end', () => {
        const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
        if (/^stream: OK$/.test(reply)) return resolve({ clean: true });
        const found = /^stream: (.+) FOUND$/.exec(reply);
        if (found?.[1]) return resolve({ clean: false, signature: found[1] });
        reject(new Error(`ClamAV: resposta inesperada "${reply.slice(0, 200)}"`));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < content.length; offset += CHUNK) {
          const chunk = content.subarray(offset, offset + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length);
          socket.write(size);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
    });
  }
}

/** Somente desenvolvimento: aceita tudo e avisa. O schema de env exige ClamAV em produção. */
export class DisabledMalwareScanner implements MalwareScanner {
  private readonly logger = new Logger('MalwareScanner');

  scan(): Promise<ScanVerdict> {
    this.logger.warn(
      'Antivírus desativado (MALWARE_SCAN=disabled): arquivo liberado sem verificação.',
    );
    return Promise.resolve({ clean: true });
  }
}
